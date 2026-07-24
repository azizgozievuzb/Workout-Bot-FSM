"""Workout Session API — 35-min cycle lifecycle."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ...core.deps import get_current_user
from ...core.workout_config import (
    exercise_by_idx,
    max_drops_for,
    session_config,
    total_for,
)
from ...core.config import settings
from ...db.client import get_supabase
from ...services.workout_vision import analyze_exercise_clip
from ...services import schedule

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workout", tags=["workout"])

BUCKET = "workout-clips"
MAX_CLIP_BYTES = 30 * 1024 * 1024  # 30 MB hard cap per clip


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ExerciseMeta(BaseModel):
    idx: int
    key: str
    name: str
    hint: str
    targets: str
    position: str
    muscles: list[str]


class WorkoutConfigResponse(BaseModel):
    session_type: str
    total_exercises: int
    prepare_sec: int
    exercise_sec: int
    work_sec: int
    rest_sec: int
    review_sec: int
    max_drops_per_session: int
    exercises: list[ExerciseMeta]


class StartSessionResponse(BaseModel):
    session_id: str
    started_at: str


class ClipResponse(BaseModel):
    exercise_idx: int
    score: int
    feedback: str


class FinishSessionResponse(BaseModel):
    session_id: str
    total_score: int
    avg_score: int
    drops_earned: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _resolve_player(db, telegram_id: int) -> str:
    res = await (
        db.table("users")
        .select("id, has_player_access")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    if not res.data.get("has_player_access"):
        raise HTTPException(status_code=403, detail="Only Players can record workouts")
    return res.data["id"]


async def _assert_session_owned(db, session_id: str, player_id: str) -> dict:
    res = await (
        db.table("workout_sessions")
        .select("id, player_id, status, started_at, session_type")
        .eq("id", session_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="Session not found")
    if res.data["player_id"] != player_id:
        raise HTTPException(status_code=403, detail="Not your session")
    return res.data


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@router.get("/config", response_model=WorkoutConfigResponse)
async def get_config(session_type: str = "main", user: dict = Depends(get_current_user)):
    cfg = session_config(session_type)
    return WorkoutConfigResponse(
        session_type=cfg["session_type"],
        total_exercises=cfg["total_exercises"],
        prepare_sec=cfg["prepare_sec"],
        exercise_sec=cfg["exercise_sec"],
        work_sec=cfg["work_sec"],
        rest_sec=cfg["rest_sec"],
        review_sec=cfg["review_sec"],
        max_drops_per_session=cfg["max_drops_per_session"],
        exercises=[ExerciseMeta(**e) for e in cfg["exercises"]],
    )


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

class StartSessionReq(BaseModel):
    tz_offset_min: int | None = Field(default=None, ge=-720, le=840)
    session_type: str = "main"


@router.post("/start", response_model=StartSessionResponse)
async def start_session(body: StartSessionReq, user: dict = Depends(get_current_user)):
    db = await get_supabase()
    player_id = await _resolve_player(db, user["telegram_id"])

    session_type = "light" if body.session_type == "light" else "main"
    if session_type == "light":
        # light-сессию можно начать, пока light-режим АКТИВЕН (та же логика, что
        # в лобби/finish): unlocked→today>=active_from; после Lock — доигрываем
        # неделю до next_monday(light_locked_at). Гейтить по сырому light_unlocked
        # нельзя: Lock сбрасывает флаг, но light-дни ещё плановые до пн.
        u = await (
            db.table("users")
            .select("timezone, light_unlocked, light_active_from, light_locked_at")
            .eq("id", player_id).maybe_single().execute()
        )
        urow = u.data if (u and u.data) else {}
        if not schedule.light_is_active(urow, schedule.local_today(urow.get("timezone"))):
            raise HTTPException(status_code=403, detail={"code": "LIGHT_LOCKED"})

    # Kill any stale in_progress session for this player (safety — stale unmount)
    stale = await (
        db.table("workout_sessions")
        .select("id, started_at")
        .eq("player_id", player_id)
        .eq("status", "in_progress")
        .execute()
    )
    if stale.data:
        await (
            db.table("workout_sessions")
            .update({"status": "cancelled", "finished_at": datetime.now(timezone.utc).isoformat()})
            .eq("player_id", player_id)
            .eq("status", "in_progress")
            .execute()
        )

    ins = await (
        db.table("workout_sessions")
        .insert({
            "player_id": player_id,
            "client_tz_offset": body.tz_offset_min,
            "session_type": session_type,
        })
        .execute()
    )
    row = (ins.data or [{}])[0]
    return StartSessionResponse(session_id=row["id"], started_at=row["started_at"])


# ---------------------------------------------------------------------------
# Upload clip + AI analyze (sync; FSM rest-phase absorbs latency)
# ---------------------------------------------------------------------------

@router.post("/clip", response_model=ClipResponse)
async def upload_clip(
    session_id: str = Form(...),
    exercise_idx: int = Form(...),
    video: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()
    player_id = await _resolve_player(db, user["telegram_id"])
    session = await _assert_session_owned(db, session_id, player_id)

    if session["status"] != "in_progress":
        raise HTTPException(status_code=409, detail="Session not in progress")

    try:
        exercise = exercise_by_idx(exercise_idx, session.get("session_type"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    payload = await video.read()
    if len(payload) == 0:
        raise HTTPException(status_code=400, detail="Empty clip")
    if len(payload) > MAX_CLIP_BYTES:
        raise HTTPException(status_code=413, detail="Clip too large")

    mime = video.content_type or "video/webm"

    # Upload to Storage (non-fatal if bucket missing)
    base = settings.SUPABASE_URL.strip().strip("'").strip('"').rstrip("/")
    path = f"{player_id}/{session_id}/{exercise_idx}.webm"
    video_url: str | None = None
    try:
        await db.storage.from_(BUCKET).upload(
            path=path,
            file=payload,
            file_options={"content-type": mime, "x-upsert": "true"},
        )
        video_url = f"{base}/storage/v1/object/public/{BUCKET}/{path}"
    except Exception as e:
        logger.warning("workout clip upload failed (non-fatal): %s", e)

    # AI verdict
    verdict = await analyze_exercise_clip(payload, mime, exercise)
    score = int(verdict["score"])
    feedback = str(verdict["feedback"])

    # Upsert exercise row
    await (
        db.table("workout_exercises")
        .upsert(
            {
                "session_id": session_id,
                "exercise_idx": exercise_idx,
                "exercise_key": exercise.key,
                "video_url": video_url,
                "ai_score": score,
                "feedback": feedback,
            },
            on_conflict="session_id,exercise_idx",
        )
        .execute()
    )

    return ClipResponse(exercise_idx=exercise_idx, score=score, feedback=feedback)


# ---------------------------------------------------------------------------
# Finish
# ---------------------------------------------------------------------------

@router.post("/finish", response_model=FinishSessionResponse)
async def finish_session(session_id: str = Form(...), user: dict = Depends(get_current_user)):
    db = await get_supabase()
    player_id = await _resolve_player(db, user["telegram_id"])
    session = await _assert_session_owned(db, session_id, player_id)

    if session["status"] != "in_progress":
        raise HTTPException(status_code=409, detail="Session already finalized")

    session_type = "light" if session.get("session_type") == "light" else "main"
    total_ex = total_for(session_type)
    max_drops = max_drops_for(session_type)

    ex_res = await (
        db.table("workout_exercises")
        .select("ai_score")
        .eq("session_id", session_id)
        .execute()
    )
    scores = [int(r.get("ai_score") or 0) for r in (ex_res.data or [])]
    total = sum(scores)

    # Read player_stats up-front: streak BEFORE this workout drives streak_mult.
    stats_res = await (
        db.table("player_stats")
        .select("drops_balance, current_streak, best_streak, last_workout_date, "
                "last_closed_day, last_main_drops_day, last_light_drops_day")
        .eq("player_id", player_id)
        .maybe_single()
        .execute()
    )
    cur = stats_res.data if stats_res and stats_res.data else {}
    current_streak = int(cur.get("current_streak") or 0)

    cfg_res = await (
        db.table("users")
        .select("timezone, main_days, pending_main_days, pending_schedule_from, "
                "light_unlocked, light_active_from, light_locked_at")
        .eq("id", player_id)
        .maybe_single()
        .execute()
    )
    cfg = cfg_res.data if cfg_res and cfg_res.data else {}
    l_today = schedule.local_today(cfg.get("timezone"))
    today = l_today.isoformat()

    # Антифарм: капли максимум за 1 main + 1 light сессию в день (лок. TZ).
    # Повторная сессия того же типа сегодня → 0 капель (сессия и XP сохраняются).
    day_col = "last_main_drops_day" if session_type == "main" else "last_light_drops_day"
    already_earned_today = schedule._to_date(cur.get(day_col)) == l_today

    # Drops (Капли 💧) formula — обобщено по session_type (core/workout_config.py).
    done_scores = [s for s in scores if s > 0]
    done_count  = len(done_scores)
    quality     = (sum(done_scores) / done_count / 100.0) if done_count > 0 else 0.0
    completion  = (done_count / total_ex) ** 0.65 if done_count > 0 else 0.0
    streak_mult = 1 + min(current_streak, 20) * 0.015   # cap +30%
    raw         = max_drops * quality * completion * streak_mult
    drops       = 0 if already_earned_today else round(min(raw, max_drops))
    avg         = round(quality * 100)  # XP shown in final card = quality% of done exercises

    now_iso = datetime.now(timezone.utc).isoformat()
    await (
        db.table("workout_sessions")
        .update(
            {
                "status": "finished",
                "finished_at": now_iso,
                "total_score": total,
                "drops_earned": drops,
            }
        )
        .eq("id", session_id)
        .execute()
    )

    # Credit drops_balance + last_workout_date + streak on player_stats.
    # Капли начисляются за любую тренировку (кроме антифарм-повтора); СТРИК
    # закрывается только сессией, закрывающей сегодняшний плановый день (8b).
    new_balance = int(cur.get("drops_balance") or 0) + drops

    upsert_payload = {
        "player_id": player_id,
        "drops_balance": new_balance,
        "last_workout_date": today,
    }
    if not already_earned_today:
        upsert_payload[day_col] = today

    planned = schedule.planned_day_type(cfg, l_today)
    streak = current_streak
    if (
        schedule.session_closes_day(planned, session_type)
        and cur.get("last_closed_day") != today
    ):
        # плановый день закрыт впервые сегодня → стрик +1
        streak = current_streak + 1
        upsert_payload["current_streak"] = streak
        upsert_payload["last_closed_day"] = today
        upsert_payload["best_streak"] = max(int(cur.get("best_streak") or 0), streak)

    await db.table("player_stats").upsert(upsert_payload, on_conflict="player_id").execute()

    return FinishSessionResponse(
        session_id=session_id,
        total_score=total,
        avg_score=avg,
        drops_earned=drops,
    )


@router.post("/cancel")
async def cancel_session(session_id: str = Form(...), user: dict = Depends(get_current_user)):
    db = await get_supabase()
    player_id = await _resolve_player(db, user["telegram_id"])
    await _assert_session_owned(db, session_id, player_id)
    await (
        db.table("workout_sessions")
        .update(
            {
                "status": "cancelled",
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", session_id)
        .eq("status", "in_progress")
        .execute()
    )
    return {"ok": True}

"""Workout Session API — 35-min cycle lifecycle."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from ...core.deps import get_current_user
from ...core.workout_config import (
    EXERCISE_SEC,
    MAX_STARS_PER_SESSION,
    PREPARE_SEC,
    REST_SEC,
    REVIEW_SEC,
    TOTAL_EXERCISES,
    as_public_list,
    exercise_by_idx,
)
from ...core.config import settings
from ...db.client import get_supabase
from ...services.workout_vision import analyze_exercise_clip

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


class WorkoutConfigResponse(BaseModel):
    total_exercises: int
    prepare_sec: int
    exercise_sec: int
    rest_sec: int
    review_sec: int
    max_stars_per_session: int
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
    stars_earned: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _resolve_player(db, telegram_id: int) -> str:
    res = await (
        db.table("users")
        .select("id, role")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    if res.data.get("role") != "player":
        raise HTTPException(status_code=403, detail="Only Players can record workouts")
    return res.data["id"]


async def _assert_session_owned(db, session_id: str, player_id: str) -> dict:
    res = await (
        db.table("workout_sessions")
        .select("id, player_id, status, started_at")
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
async def get_config(user: dict = Depends(get_current_user)):
    return WorkoutConfigResponse(
        total_exercises=TOTAL_EXERCISES,
        prepare_sec=PREPARE_SEC,
        exercise_sec=EXERCISE_SEC,
        rest_sec=REST_SEC,
        review_sec=REVIEW_SEC,
        max_stars_per_session=MAX_STARS_PER_SESSION,
        exercises=[ExerciseMeta(**e) for e in as_public_list()],
    )


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

class StartSessionReq(BaseModel):
    tz_offset_min: int | None = Field(default=None, ge=-720, le=840)


@router.post("/start", response_model=StartSessionResponse)
async def start_session(body: StartSessionReq, user: dict = Depends(get_current_user)):
    db = await get_supabase()
    player_id = await _resolve_player(db, user["telegram_id"])

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
        .insert({"player_id": player_id, "client_tz_offset": body.tz_offset_min})
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
        exercise = exercise_by_idx(exercise_idx)
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

    ex_res = await (
        db.table("workout_exercises")
        .select("ai_score")
        .eq("session_id", session_id)
        .execute()
    )
    scores = [int(r.get("ai_score") or 0) for r in (ex_res.data or [])]
    total = sum(scores)
    avg = round(total / TOTAL_EXERCISES)
    # Star formula: avg% * scale
    stars = round(avg * MAX_STARS_PER_SESSION / 100)

    now_iso = datetime.now(timezone.utc).isoformat()
    await (
        db.table("workout_sessions")
        .update(
            {
                "status": "finished",
                "finished_at": now_iso,
                "total_score": total,
                "stars_earned": stars,
            }
        )
        .eq("id", session_id)
        .execute()
    )

    # Credit star_balance + last_workout_date + streak on player_stats
    stats_res = await (
        db.table("player_stats")
        .select("star_balance, current_streak, best_streak, last_workout_date")
        .eq("player_id", player_id)
        .maybe_single()
        .execute()
    )
    cur = stats_res.data if stats_res and stats_res.data else {}
    new_balance = int(cur.get("star_balance") or 0) + stars
    today = datetime.now(timezone.utc).date().isoformat()
    last = cur.get("last_workout_date")
    streak = int(cur.get("current_streak") or 0)
    if last == today:
        pass  # already counted today
    elif last and (datetime.fromisoformat(today).toordinal() - datetime.fromisoformat(last).toordinal()) == 1:
        streak += 1
    else:
        streak = 1
    best = max(int(cur.get("best_streak") or 0), streak)

    upsert_payload = {
        "player_id": player_id,
        "star_balance": new_balance,
        "last_workout_date": today,
        "current_streak": streak,
        "best_streak": best,
    }
    await db.table("player_stats").upsert(upsert_payload, on_conflict="player_id").execute()

    return FinishSessionResponse(
        session_id=session_id,
        total_score=total,
        avg_score=avg,
        stars_earned=stars,
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

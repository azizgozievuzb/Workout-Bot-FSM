"""Workout Session API — 35-min cycle lifecycle."""
import logging
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ...core.deps import get_current_user
from ...core.workout_config import (
    SUPPORT_PHRASES,
    exercise_by_idx,
    max_drops_for,
    session_config,
    total_for,
)
from ...core.config import settings
from ...db.client import get_supabase
from ...services.notifications import emit_notification
from ...services.workout_vision import analyze_exercise_clip
from ...services import leveling, schedule

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
    # S67: тип и «свободность» решает СЕРВЕР (день вне плана → свободная light).
    # Фронт подстраивается под ответ, а не наоборот — иначе клиент мог бы
    # объявить плановым любой день и получить начисления за свободный.
    session_type: str = "main"
    is_free: bool = False


class ClipResponse(BaseModel):
    exercise_idx: int
    score: int
    feedback: str


class FinishSessionResponse(BaseModel):
    session_id: str
    total_score: int
    avg_score: int
    drops_earned: int
    # 8c: частичный зачёт + антифарм
    exercises_done: int = 0        # клипов загружено (включая 0-балльные)
    total_exercises: int = 0
    completed_full: bool = False   # все N упражнений пройдены
    day_closed: bool = False       # эта сессия закрыла плановый день (стрик +1)
    repeat: bool = False           # повторная сессия типа за день → без начислений
    support_phrase: str | None = None  # фраза поддержки при repeat / свободной
    # S67: XP и уровни. avg_score выше — это ТЕХНИКА (средний балл Gemini),
    # xp_earned — реальное начисление. До S67 экран путал одно с другим.
    xp_earned: int = 0
    level: int = 0
    xp_in_level: int = 0
    level_cost: int = 0
    level_ups: list[int] = []      # уровни, взятые этой сессией (обычно 0 или 1)
    freezes_granted: int = 0       # разовые заморозки за взятые уровни
    is_free: bool = False          # свободная тренировка: без камеры и начислений


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _freezes_word(n: int) -> str:
    """«1 заморозка / 2 заморозки / 5 заморозок» — русские окончания."""
    if 11 <= n % 100 <= 14:
        return "заморозок"
    tail = n % 10
    if tail == 1:
        return "заморозка"
    if tail in (2, 3, 4):
        return "заморозки"
    return "заморозок"


async def _resolve_player(db, telegram_id: int) -> dict:
    """Строка users игрока СО ВСЕМ, что нужно расписанию (S67).

    Один SELECT на запрос вместо двух: `finish` раньше читал users второй раз
    ради main_days/light — теперь берёт из этой же строки. Каждый поход
    Railway→Supabase стоит ≈0.5 с (замер S66), лишний тут заметен глазом.
    """
    res = await (
        db.table("users")
        .select("id, has_player_access, timezone, main_days, pending_main_days, "
                f"pending_schedule_from, {schedule.LIGHT_COLS}")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    if not res.data.get("has_player_access"):
        raise HTTPException(status_code=403, detail="Only Players can record workouts")
    return res.data


async def _assert_session_owned(db, session_id: str, player_id: str) -> dict:
    res = await (
        db.table("workout_sessions")
        .select("id, player_id, status, started_at, session_type, is_free")
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
    me = await _resolve_player(db, user["telegram_id"])
    player_id = me["id"]

    session_type = "light" if body.session_type == "light" else "main"

    # S67: день вне плана = СВОБОДНАЯ тренировка. Формат — light (4 упражнения),
    # но без камеры, без Gemini и без начислений. Решает сервер: клиент не может
    # выдать свободный день за плановый и наоборот.
    l_today = schedule.local_today(me.get("timezone"))
    is_free = schedule.planned_day_type(me, l_today) is None
    if is_free:
        session_type = "light"
    elif session_type == "light":
        # light-сессию можно начать, пока light-режим АКТИВЕН (та же логика, что
        # в лобби/finish): unlocked→today>=active_from; после Lock — доигрываем
        # неделю до next_monday(light_locked_at). Гейтить по сырому light_unlocked
        # нельзя: Lock сбрасывает флаг, но light-дни ещё плановые до пн.
        if not schedule.light_is_active(me, l_today):
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
            "is_free": is_free,
        })
        .execute()
    )
    row = (ins.data or [{}])[0]
    return StartSessionResponse(
        session_id=row["id"],
        started_at=row["started_at"],
        session_type=session_type,
        is_free=is_free,
    )


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
    player_id = (await _resolve_player(db, user["telegram_id"]))["id"]
    session = await _assert_session_owned(db, session_id, player_id)

    if session["status"] != "in_progress":
        raise HTTPException(status_code=409, detail="Session not in progress")
    # S67: свободная тренировка не пишет клипы и не зовёт Gemini — гейт стоит
    # на СЕРВЕРЕ, а не только в UI: каждый клип это прямые деньги владельца.
    if session.get("is_free"):
        raise HTTPException(status_code=409, detail={"code": "FREE_SESSION_NO_CLIPS"})

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
    me = await _resolve_player(db, user["telegram_id"])
    player_id = me["id"]
    session = await _assert_session_owned(db, session_id, player_id)

    if session["status"] != "in_progress":
        raise HTTPException(status_code=409, detail="Session already finalized")

    session_type = "light" if session.get("session_type") == "light" else "main"
    total_ex = total_for(session_type)
    max_drops = max_drops_for(session_type)
    now_iso = datetime.now(timezone.utc).isoformat()

    # S67: свободная тренировка (день вне плана) — закрываем сессию и выходим.
    # Ни капель, ни XP, ни стрика, ни last_workout_date (её увидели бы джобы
    # напоминаний и сломанного стрика как «сегодня тренировался»), ни дневных
    # антифарм-полей: свободный день не может стать обходным путём.
    if session.get("is_free"):
        await (
            db.table("workout_sessions")
            .update({"status": "finished", "finished_at": now_iso})
            .eq("id", session_id)
            .execute()
        )
        return FinishSessionResponse(
            session_id=session_id,
            total_score=0,
            avg_score=0,
            drops_earned=0,
            exercises_done=0,
            total_exercises=total_ex,
            is_free=True,
            support_phrase=random.choice(SUPPORT_PHRASES),
        )

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
                "last_closed_day, last_main_drops_day, last_light_drops_day, "
                "global_score, last_rewarded_level, paid_freezes")
        .eq("player_id", player_id)
        .maybe_single()
        .execute()
    )
    cur = stats_res.data if stats_res and stats_res.data else {}
    current_streak = int(cur.get("current_streak") or 0)

    # Расписание берём из строки, прочитанной _resolve_player — второго
    # SELECT-а по users здесь больше нет (S67, ≈0.5 с на поход в Supabase).
    cfg = me
    l_today = schedule.local_today(cfg.get("timezone"))
    today = l_today.isoformat()

    # Антифарм (8c): начисления — капли И XP — только за ПЕРВУЮ сессию каждого
    # типа в день (лок. TZ). Повторная сессия того же типа → drops 0, XP 0,
    # repeat=true + фраза поддержки (сессия сохраняется, полная может закрыть день).
    day_col = "last_main_drops_day" if session_type == "main" else "last_light_drops_day"
    already_earned_today = schedule._to_date(cur.get(day_col)) == l_today

    # Drops (Капли 💧) formula — обобщено по session_type (core/workout_config.py).
    # Частичный зачёт (ранний выход): (done/N)^0.65 работает при done < N.
    done_scores = [s for s in scores if s > 0]
    done_count  = len(done_scores)
    attempted   = len(scores)              # клипов загружено (включая 0-балльные)
    # Полная сессия = пройдены ВСЕ N упражнений (клип каждого дошёл до бэка;
    # 0-балльные считаются пройденными). Только она закрывает стрик-день.
    completed_full = attempted >= total_ex
    quality     = (sum(done_scores) / done_count / 100.0) if done_count > 0 else 0.0
    completion  = (done_count / total_ex) ** 0.65 if done_count > 0 else 0.0
    streak_mult = 1 + min(current_streak, 20) * 0.015   # cap +30%
    raw         = max_drops * quality * completion * streak_mult
    drops       = 0 if already_earned_today else round(min(raw, max_drops))
    # ТЕХНИКА (средний балл Gemini) — под тем же антифармом, что и капли.
    # До S67 это число уезжало на экран с подписью «XP» и врало игроку.
    avg         = 0 if already_earned_today else round(quality * 100)

    # XP (S67) = сумма баллов Gemini × множитель типа сессии. Тот же
    # антифарм-гейт, что у капель: повторная сессия дня даёт ноль (инвариант №3).
    xp_settings = await leveling.get_settings(db)
    xp_earned = 0 if already_earned_today else leveling.xp_for_session(total, session_type, xp_settings)
    old_xp = int(cur.get("global_score") or 0)
    new_xp = old_xp + xp_earned
    level, xp_in_level, cost_next = leveling.level_from_xp(new_xp, xp_settings)

    # Награды за уровень (Кусок 2): разовая выдача заморозок за КАЖДЫЙ взятый
    # уровень. Идемпотентность — last_rewarded_level: даже если XP пересчитают
    # или сессия финишируется повторно, второй раз за тот же уровень не дадут.
    last_rewarded = int(cur.get("last_rewarded_level") or 0)
    level_ups: list[int] = list(range(last_rewarded + 1, level + 1)) if level > last_rewarded else []
    freezes_granted = sum(leveling.freeze_reward(n, xp_settings) for n in level_ups)

    await (
        db.table("workout_sessions")
        .update(
            {
                "status": "finished",
                "finished_at": now_iso,
                "total_score": total,
                "drops_earned": drops,
                "completed_full": completed_full,
            }
        )
        .eq("id", session_id)
        .execute()
    )

    # Credit drops_balance + last_workout_date + streak on player_stats.
    # Капли начисляются за любую тренировку (кроме антифарм-повтора); СТРИК
    # закрывается только ПОЛНОЙ сессией, закрывающей сегодняшний плановый день (8c).
    new_balance = int(cur.get("drops_balance") or 0) + drops

    upsert_payload = {
        "player_id": player_id,
        "drops_balance": new_balance,
        "last_workout_date": today,
    }
    if not already_earned_today:
        upsert_payload[day_col] = today
    if xp_earned:
        upsert_payload["global_score"] = new_xp
    if level_ups:
        upsert_payload["last_rewarded_level"] = level
        if freezes_granted:
            # Кап 3 (buy_paid_freeze / дарение наставника) — только на ДОКУПКУ.
            # Уровневая выдача — подарок за стаж и может временно его превысить.
            upsert_payload["paid_freezes"] = int(cur.get("paid_freezes") or 0) + freezes_granted

    planned = schedule.planned_day_type(cfg, l_today)
    streak = current_streak
    day_closed = False
    if (
        completed_full
        and schedule.session_closes_day(planned, session_type)
        and cur.get("last_closed_day") != today
    ):
        # плановый день закрыт впервые сегодня полной сессией → стрик +1
        streak = current_streak + 1
        day_closed = True
        upsert_payload["current_streak"] = streak
        upsert_payload["last_closed_day"] = today
        upsert_payload["best_streak"] = max(int(cur.get("best_streak") or 0), streak)

    await db.table("player_stats").upsert(upsert_payload, on_conflict="player_id").execute()

    for n in level_ups:
        k = leveling.freeze_reward(n, xp_settings)
        await emit_notification(
            db,
            user_id=player_id,
            type="level_up",
            title=f"🎉 Уровень {n}!",
            message=f"+{k} {_freezes_word(k)} ❄️" if k else "Так держать!",
            payload={"level": n, "freezes": k},
        )

    return FinishSessionResponse(
        session_id=session_id,
        total_score=total,
        avg_score=avg,
        drops_earned=drops,
        exercises_done=attempted,
        total_exercises=total_ex,
        completed_full=completed_full,
        day_closed=day_closed,
        repeat=already_earned_today,
        support_phrase=random.choice(SUPPORT_PHRASES) if already_earned_today else None,
        xp_earned=xp_earned,
        level=level,
        xp_in_level=xp_in_level,
        level_cost=cost_next,
        level_ups=level_ups,
        freezes_granted=freezes_granted,
    )


@router.post("/cancel")
async def cancel_session(session_id: str = Form(...), user: dict = Depends(get_current_user)):
    db = await get_supabase()
    player_id = (await _resolve_player(db, user["telegram_id"]))["id"]
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

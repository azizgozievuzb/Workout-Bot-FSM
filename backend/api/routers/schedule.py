"""Player schedule API (Phase 8a) — выбор/смена 3 main-дней.

Правила смены:
  * Первичная установка (main_days = NULL: онбординг / гейт довыбора) —
    мгновенно, ставит онбординговый grace = now + 14 дней.
  * Внутри grace — смена мгновенная, без кулдауна.
  * Вне grace — кулдаун 30 дней между сменами; сама смена применяется со
    следующего понедельника (pending_main_days + pending_schedule_from).
Оплата смены каплями подключится в 8c; сейчас смена бесплатная.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.deps import get_current_user
from ...db.client import get_supabase
from ...services import schedule as sched

router = APIRouter(prefix="/players", tags=["players"])

GRACE_DAYS = 14
COOLDOWN_DAYS = 30
UTC = timezone.utc


class ScheduleReq(BaseModel):
    main_days: list[int] = Field(min_length=3, max_length=3)


class ScheduleResp(BaseModel):
    main_days: list[int] | None
    pending_main_days: list[int] | None = None
    pending_schedule_from: str | None = None
    grace_until: str | None = None
    in_grace: bool = False
    next_change_available_at: str | None = None
    can_change_now: bool = True


_COLS = (
    "id, timezone, main_days, pending_main_days, pending_schedule_from, "
    "schedule_changed_at, schedule_grace_until"
)


def _parse_dt(v):
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


def _build_resp(row: dict, now: datetime) -> ScheduleResp:
    grace_until = _parse_dt(row.get("schedule_grace_until"))
    in_grace = grace_until is not None and now < grace_until
    changed_at = _parse_dt(row.get("schedule_changed_at"))
    has_days = bool(row.get("main_days"))

    next_avail = None
    can_change = True
    if has_days and not in_grace and changed_at is not None:
        na = changed_at + timedelta(days=COOLDOWN_DAYS)
        if na > now:
            next_avail = na.isoformat()
            can_change = False

    return ScheduleResp(
        main_days=row.get("main_days"),
        pending_main_days=row.get("pending_main_days"),
        pending_schedule_from=(str(row["pending_schedule_from"]) if row.get("pending_schedule_from") else None),
        grace_until=(grace_until.isoformat() if grace_until else None),
        in_grace=in_grace,
        next_change_available_at=next_avail,
        can_change_now=can_change,
    )


async def _fetch(db, tg_id: int) -> dict:
    res = await (
        db.table("users").select(_COLS).eq("telegram_id", tg_id).maybe_single().execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})
    return res.data


@router.get("/me/schedule", response_model=ScheduleResp)
async def get_schedule(current_user: dict = Depends(get_current_user)) -> ScheduleResp:
    db = await get_supabase()
    row = await _fetch(db, current_user["telegram_id"])
    return _build_resp(row, datetime.now(UTC))


class ReminderTimeReq(BaseModel):
    morning_reminder_time: str  # 'HH:MM'


@router.patch("/me/reminder-time")
async def set_reminder_time(
    body: ReminderTimeReq, current_user: dict = Depends(get_current_user)
) -> dict:
    """Локальное время утреннего напоминания (выбор часа/минуты в настройках)."""
    raw = (body.morning_reminder_time or "").strip()
    try:
        parts = [int(x) for x in raw.split(":")]
        hh, mm = parts[0], (parts[1] if len(parts) > 1 else 0)
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            raise ValueError
    except (ValueError, IndexError):
        raise HTTPException(status_code=422, detail={"code": "BAD_TIME"})

    db = await get_supabase()
    norm = f"{hh:02d}:{mm:02d}"
    res = await (
        db.table("users").update({"morning_reminder_time": norm})
        .eq("telegram_id", current_user["telegram_id"]).execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})
    return {"morning_reminder_time": norm}


@router.patch("/me/schedule", response_model=ScheduleResp)
async def set_schedule(
    body: ScheduleReq, current_user: dict = Depends(get_current_user)
) -> ScheduleResp:
    days = sorted(set(body.main_days))
    if len(days) != 3 or any(d < 0 or d > 6 for d in days):
        raise HTTPException(status_code=422, detail={"code": "BAD_MAIN_DAYS"})

    db = await get_supabase()
    now = datetime.now(UTC)
    row = await _fetch(db, current_user["telegram_id"])
    uid = row["id"]
    has_days = bool(row.get("main_days"))
    grace_until = _parse_dt(row.get("schedule_grace_until"))
    in_grace = grace_until is not None and now < grace_until

    # 1) Первичная установка — мгновенно + онбординговый grace.
    if not has_days:
        update = {
            "main_days": days,
            "pending_main_days": None,
            "pending_schedule_from": None,
            "schedule_changed_at": now.isoformat(),
            "schedule_grace_until": (now + timedelta(days=GRACE_DAYS)).isoformat(),
        }
        await db.table("users").update(update).eq("id", uid).execute()
        return _build_resp({**row, **update}, now)

    # 2) Внутри grace — мгновенно, без кулдауна.
    if in_grace:
        update = {
            "main_days": days,
            "pending_main_days": None,
            "pending_schedule_from": None,
            "schedule_changed_at": now.isoformat(),
        }
        await db.table("users").update(update).eq("id", uid).execute()
        return _build_resp({**row, **update}, now)

    # 3) Вне grace — кулдаун 30 дней; применяется со следующего понедельника.
    changed_at = _parse_dt(row.get("schedule_changed_at"))
    if changed_at is not None:
        na = changed_at + timedelta(days=COOLDOWN_DAYS)
        if na > now:
            raise HTTPException(
                status_code=409,
                detail={"code": "SCHEDULE_COOLDOWN", "next_change_available_at": na.isoformat()},
            )

    local_today = sched.local_today(row.get("timezone"), base=now)
    eff_from = sched.next_monday(local_today)
    update = {
        "pending_main_days": days,
        "pending_schedule_from": eff_from.isoformat(),
        "schedule_changed_at": now.isoformat(),
    }
    await db.table("users").update(update).eq("id", uid).execute()
    return _build_resp({**row, **update}, now)

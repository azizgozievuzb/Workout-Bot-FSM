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
    # 8b: light-режим
    light_unlocked: bool = False
    light_active: bool = False           # активен сегодня (лок. TZ)
    light_active_from: str | None = None  # понедельник активации (если ещё не наступил)
    today_session_type: str | None = None  # 'main' | 'light' | None (сегодня не плановый)
    light_unlock_price: int | None = None
    light_lock_price: int | None = None
    # 8c: смена графика вне grace — платная
    schedule_change_price: int | None = None
    # Эконом-патч №1: неделя light-трайала (лот полки). Даты — понедельники в
    # поясе игрока: старт и возврат в main-only.
    light_trial_from: str | None = None
    light_trial_until: str | None = None
    light_trial_active: bool = False


_COLS = (
    "id, timezone, main_days, pending_main_days, pending_schedule_from, "
    "schedule_changed_at, schedule_grace_until, "
    f"{sched.LIGHT_COLS}"
)


def _parse_dt(v):
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


def _build_resp(row: dict, now: datetime, prices: dict | None = None) -> ScheduleResp:
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

    # 8b: light-состояние на сегодня (лок. TZ).
    l_today = sched.local_today(row.get("timezone"), base=now)
    light_active = sched.light_is_active(row, l_today, base=now)
    planned = sched.planned_day_type(row, l_today)
    af = sched._to_date(row.get("light_active_from"))
    # Показываем дату активации, только если unlocked, но она ещё не наступила.
    af_str = af.isoformat() if (row.get("light_unlocked") and af and l_today < af) else None
    prices = prices or {}
    trial_from = sched._to_date(row.get("light_trial_from"))
    trial_until = sched._to_date(row.get("light_trial_until"))

    return ScheduleResp(
        main_days=row.get("main_days"),
        pending_main_days=row.get("pending_main_days"),
        pending_schedule_from=(str(row["pending_schedule_from"]) if row.get("pending_schedule_from") else None),
        grace_until=(grace_until.isoformat() if grace_until else None),
        in_grace=in_grace,
        next_change_available_at=next_avail,
        can_change_now=can_change,
        light_unlocked=bool(row.get("light_unlocked")),
        light_active=light_active,
        light_active_from=af_str,
        today_session_type=planned,
        light_unlock_price=prices.get("light_unlock"),
        light_lock_price=prices.get("light_lock"),
        schedule_change_price=prices.get("schedule_change"),
        light_trial_from=(trial_from.isoformat() if trial_from else None),
        light_trial_until=(trial_until.isoformat() if trial_until else None),
        light_trial_active=sched.trial_covers(row, l_today),
    )


async def _light_prices(db) -> dict:
    res = await (
        db.table("app_shop_items").select("key, price_drops")
        .in_("key", ["light_unlock", "light_lock", "schedule_change"]).execute()
    )
    return {r["key"]: int(r["price_drops"]) for r in (res.data or [])}


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
    prices = await _light_prices(db)
    return _build_resp(row, datetime.now(UTC), prices)


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

    # 8c: вне grace смена платная (schedule_change из app_shop_items).
    # Не хватает капель → 400 INSUFFICIENT_DROPS с ценой в detail (_charge_drops).
    prices = await _light_prices(db)
    change_price = prices.get("schedule_change")
    if change_price is None:
        raise HTTPException(status_code=500, detail={"code": "PRICE_NOT_CONFIGURED"})
    await _charge_drops(db, uid, change_price)

    local_today = sched.local_today(row.get("timezone"), base=now)
    eff_from = sched.next_monday(local_today)
    update = {
        "pending_main_days": days,
        "pending_schedule_from": eff_from.isoformat(),
        "schedule_changed_at": now.isoformat(),
    }
    await db.table("users").update(update).eq("id", uid).execute()
    return _build_resp({**row, **update}, now, prices)


# ---------------------------------------------------------------------------
# Light unlock / lock (Phase 8b)
# ---------------------------------------------------------------------------

async def _charge_drops(db, player_id: str, price: int) -> None:
    """Списание drops_balance по цене (read-then-write). Баланс < цены → 400."""
    ps = await (
        db.table("player_stats").select("drops_balance")
        .eq("player_id", player_id).maybe_single().execute()
    )
    bal = int((ps.data or {}).get("drops_balance") or 0) if ps else 0
    if bal < price:
        raise HTTPException(
            status_code=400,
            detail={"code": "INSUFFICIENT_DROPS", "balance": bal, "price": price},
        )
    await (
        db.table("player_stats").update({"drops_balance": bal - price})
        .eq("player_id", player_id).execute()
    )


@router.post("/me/light-unlock", response_model=ScheduleResp)
async def light_unlock(current_user: dict = Depends(get_current_user)) -> ScheduleResp:
    db = await get_supabase()
    now = datetime.now(UTC)
    row = await _fetch(db, current_user["telegram_id"])
    uid = row["id"]
    prices = await _light_prices(db)
    price = prices.get("light_unlock")
    if price is None:
        raise HTTPException(status_code=500, detail={"code": "PRICE_NOT_CONFIGURED"})
    if row.get("light_unlocked"):
        raise HTTPException(status_code=409, detail={"code": "ALREADY_UNLOCKED"})

    await _charge_drops(db, uid, price)

    l_today = sched.local_today(row.get("timezone"), base=now)
    active_from = sched.next_monday(l_today)
    update = {
        "light_unlocked": True,
        "light_active_from": active_from.isoformat(),
        "light_locked_at": None,
    }
    await db.table("users").update(update).eq("id", uid).execute()
    return _build_resp({**row, **update}, now, prices)


@router.post("/me/light-lock", response_model=ScheduleResp)
async def light_lock(current_user: dict = Depends(get_current_user)) -> ScheduleResp:
    db = await get_supabase()
    now = datetime.now(UTC)
    row = await _fetch(db, current_user["telegram_id"])
    uid = row["id"]
    prices = await _light_prices(db)
    price = prices.get("light_lock")
    if price is None:
        raise HTTPException(status_code=500, detail={"code": "PRICE_NOT_CONFIGURED"})
    if not row.get("light_unlocked"):
        raise HTTPException(status_code=409, detail={"code": "NOT_UNLOCKED"})

    await _charge_drops(db, uid, price)

    # light_unlocked=false; до следующего пн light-дни ещё плановые (доиграть
    # неделю честно) — это считает light_is_active по light_locked_at.
    update = {
        "light_unlocked": False,
        "light_locked_at": now.isoformat(),
        "light_active_from": None,
    }
    await db.table("users").update(update).eq("id", uid).execute()
    return _build_resp({**row, **update}, now, prices)

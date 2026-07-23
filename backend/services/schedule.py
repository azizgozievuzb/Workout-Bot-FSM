"""Schedule / timezone helpers (Phase 8a).

Соглашение о днях недели: 0=понедельник … 6=воскресенье (совместимо с
``datetime.date.weekday()``). ``main_days`` в БД хранит ровно 3 таких числа.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger(__name__)

UTC = timezone.utc


def get_tz(tz_str: str | None) -> ZoneInfo | timezone:
    """IANA-строка → tzinfo. NULL/битая зона → UTC-фолбэк."""
    if not tz_str:
        return UTC
    try:
        return ZoneInfo(tz_str)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        logger.warning("[schedule] bad timezone %r → UTC fallback", tz_str)
        return UTC


def is_valid_tz(tz_str: str) -> bool:
    try:
        ZoneInfo(tz_str)
        return True
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return False


def local_now(tz_str: str | None, *, base: datetime | None = None) -> datetime:
    """Текущее (aware) локальное время юзера. ``base`` — для тестируемости."""
    ref = base or datetime.now(UTC)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=UTC)
    return ref.astimezone(get_tz(tz_str))


def local_today(tz_str: str | None, *, base: datetime | None = None) -> date:
    return local_now(tz_str, base=base).date()


def is_main_day(main_days: list[int] | None, d: date) -> bool:
    if not main_days:
        return False
    return d.weekday() in main_days


def effective_main_days(user_row: dict, today: date) -> list[int] | None:
    """Активные main-дни с учётом отложенной смены.

    Если есть ``pending_main_days`` и ``pending_schedule_from`` уже наступил
    (today >= from) — активными считаются pending. Иначе — ``main_days``.
    Промоушен (запись pending → main_days) делает почасовой closure-джоб в
    локальный пн 00:00; здесь только читаем «как есть сейчас».
    """
    pending = user_row.get("pending_main_days")
    pfrom = user_row.get("pending_schedule_from")
    if pending and pfrom:
        try:
            pfrom_d = pfrom if isinstance(pfrom, date) else date.fromisoformat(str(pfrom)[:10])
            if today >= pfrom_d:
                return list(pending)
        except (ValueError, TypeError):
            pass
    md = user_row.get("main_days")
    return list(md) if md else None


def parse_reminder_time(val) -> time:
    """TIME из БД (строка 'HH:MM[:SS]' или time) → datetime.time. Фолбэк 08:00."""
    if isinstance(val, time):
        return val
    if isinstance(val, str) and val:
        try:
            parts = [int(x) for x in val.split(":")]
            return time(parts[0], parts[1] if len(parts) > 1 else 0)
        except (ValueError, IndexError):
            pass
    return time(8, 0)


def next_monday(d: date) -> date:
    """Ближайший понедельник строго ПОСЛЕ d (для активации смены графика)."""
    from datetime import timedelta
    days_ahead = 7 - d.weekday()  # пн(0) → 7, вс(6) → 1
    if days_ahead == 0:
        days_ahead = 7
    return d + timedelta(days=days_ahead)

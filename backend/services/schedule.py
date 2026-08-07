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

# Колонки light-состояния для SELECT-ов. Держим ОДНОЙ строкой: light_is_active
# читает пять полей, и стоит забыть одно в чьём-нибудь select — режим молча
# «выключается» именно там (класс бага S54/S56: фильтр по неполной модели).
LIGHT_COLS = (
    "light_unlocked, light_active_from, light_locked_at, "
    "light_trial_from, light_trial_until"
)


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


# ---------------------------------------------------------------------------
# Light mode (Phase 8b)
# ---------------------------------------------------------------------------

def trial_covers(user_row: dict, today: date) -> bool:
    """Идёт ли неделя light-трайала (эконом-патч №1, лот `light_trial`).

    Окно [light_trial_from, light_trial_until) — ровно одна календарная неделя:
    старт «со следующего пн после выкупа», возврат в main-only — следующим пн.
    Оба конца считает та же ``next_monday``, что у unlock/lock: второго
    календаря в проекте нет.
    """
    tf = _to_date(user_row.get("light_trial_from"))
    tu = _to_date(user_row.get("light_trial_until"))
    return tf is not None and tu is not None and tf <= today < tu


def light_is_active(user_row: dict, today: date, *, base: datetime | None = None) -> bool:
    """Активен ли light-режим на дату ``today`` (лок. TZ).

    * идёт трайал     → активен (полный график недели, стрик-правила light).
    * unlocked=true  → активен, если today >= light_active_from.
    * unlocked=false → «доиграть неделю честно» после lock: активен, пока
      today < next_monday(локальная дата light_locked_at). Потом main-only.
    """
    tz = user_row.get("timezone")
    if trial_covers(user_row, today):
        return True
    if user_row.get("light_unlocked"):
        af = _to_date(user_row.get("light_active_from"))
        return af is not None and today >= af
    locked = user_row.get("light_locked_at")
    if not locked:
        return False
    lk_local = local_today(tz, base=_to_dt(locked, base))
    if lk_local is None:
        return False
    return today < next_monday(lk_local)


def planned_day_type(user_row: dict, today: date) -> str | None:
    """Тип планового дня: 'main' | 'light' | None (день не плановый).

    * light активен  → плановый КАЖДЫЙ день: main-дни = 'main', остальные = 'light'.
    * light не активен → плановые только main-дни ('main'); прочие — None.
    """
    md = effective_main_days(user_row, today)
    is_md = is_main_day(md, today)
    if light_is_active(user_row, today):
        return "main" if is_md else "light"
    return "main" if is_md else None


def session_closes_day(planned_type: str | None, session_type: str) -> bool:
    """Закрывает ли сессия ``session_type`` плановый день типа ``planned_type``.

    * main-день  — только main-сессией.
    * light-день — light ИЛИ main (перевыполнение не наказываем).
    """
    if planned_type == "main":
        return session_type == "main"
    if planned_type == "light":
        return session_type in ("main", "light")
    return False


def _to_date(v) -> date | None:
    if not v:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except (ValueError, TypeError):
        return None


def _to_dt(v, base: datetime | None) -> datetime | None:
    """light_locked_at → aware datetime (для конверсии в лок. дату)."""
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except (ValueError, TypeError):
        return base or datetime.now(UTC)

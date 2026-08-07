"""Полка наставника (Фаза 8d) — общие хелперы.

Слоты полки считаются от ЖИВОЙ подписки Ответственного (std 2 / prm 4 / elt 6
на игрока) и НЕ снапшотятся в строку лота (принцип BACKLOG S48 №1).
Видео-обещания лежат в ПРИВАТНОМ бакете `promises`; наружу отдаются только
подписанными ссылками, выдаваемыми бэком членам пары (§8.8a п.8).
"""
import logging
import uuid
from datetime import date, datetime
from typing import Any

from . import schedule as sched_svc

logger = logging.getLogger(__name__)

# Слоты полки на одного игрока — второе отличие тарифов после лимита игроков (§8.8).
SHELF_SLOTS_BY_TIER = {"standard": 2, "premium": 4, "elite": 6}

# Слот занимают выставленные и скрытые лоты; купленные/исполненные — освобождают.
OCCUPYING_STATUSES = ("active", "hidden")

PROMISE_BUCKET = "promises"
MAX_PROMISE_BYTES = 30 * 1024 * 1024        # как у тренировочных клипов
PROMISE_MIMES = ("video/webm", "video/mp4", "video/quicktime")
SIGNED_URL_TTL_SEC = 3600

# Фолбэки, если строка лимитов выключена/удалена в админке.
PRICE_MIN_DEFAULT = 50
PRICE_MAX_DEFAULT = 2000

GENDER_WORDS = {"male": "парень", "female": "девушка"}
GOAL_WORDS = {
    "lose_weight": "похудеть",
    "build_muscle": "набрать массу",
    "endurance": "выносливость",
    "health": "здоровье",
    "flexibility": "гибкость",
}
FITNESS_WORDS = {
    "beginner": "начинающий",
    "intermediate": "средний уровень",
    "advanced": "продвинутый",
}

# 0=понедельник … 6=воскресенье — соглашение services/schedule.py и main_days.
WEEKDAY_SHORT = ("пн", "вт", "ср", "чт", "пт", "сб", "вс")

# Ниже этого остатка чип подписки краснеет: после grace игрок теряет доступ,
# и наставник должен увидеть это ЗАРАНЕЕ, а не по факту (8d.1a).
SUBSCRIPTION_WARN_DAYS = 3

# Кап запаса докупленных/подаренных заморозок. Дублируется в БД CHECK-ом
# player_stats_paid_freezes_cap (034) — держим одно число на весь бэк.
PAID_FREEZE_CAP = 3


def format_main_days(main_days: list[int] | None) -> str:
    """[0,2,4] → «пн·ср·пт». Порядок нормализуем — в БД он не гарантирован."""
    if not main_days:
        return ""
    days = sorted({int(d) for d in main_days if 0 <= int(d) <= 6})
    return "·".join(WEEKDAY_SHORT[d] for d in days)


def profile_line(user_row: dict) -> str:
    """«девушка · похудеть · начинающий» — данные онбординг-опроса 7.5.1.
    Дисклоз игроку («будут видны наставнику») — на шаге пола (§8.7)."""
    parts = [
        GENDER_WORDS.get(user_row.get("gender") or ""),
        GOAL_WORDS.get(user_row.get("goal") or ""),
        FITNESS_WORDS.get(user_row.get("fitness_level") or ""),
    ]
    return " · ".join(p for p in parts if p)


def profile_chips(user_row: dict, sub_days_left: int | None = None) -> list[dict]:
    """8d.1 (П.3a): те же атрибуты, но структурно — чипы столбиком у фото.
    Плоская строка «Игрок: парень · выносливость · средний уровень» ломалась о
    длинные слова и читалась как подпись, а не как досье.

    8d.1a (Д1): чип «пол» убран без замены — наставник и так знает своего
    игрока, строка занимала место и ничего не сообщала. Взамен два чипа,
    которые наставнику реально нужны в работе: график тренировок игрока и
    остаток ОПЛАЧЕННОГО ПЕРИОДА ПОДПИСКИ (одинаков на страницах всех игроков —
    подписка одна на наставника, это осознанно).
    """
    raw: list[tuple[str, str, str, str | None]] = [
        ("🎯", "Цель", GOAL_WORDS.get(user_row.get("goal") or ""), None),
        ("💪", "Подготовка", FITNESS_WORDS.get(user_row.get("fitness_level") or ""), None),
        ("📅", "График", format_main_days(user_row.get("main_days")), None),
    ]
    if sub_days_left is not None:
        # Формулировка ОБЯЗАНА говорить про подписку: «осталось N дн» на
        # странице игрока читается как срок жизни игрока (решение юзера).
        raw.append((
            "⏳", "Подписка", f"{sub_days_left} дн",
            "warn" if sub_days_left <= SUBSCRIPTION_WARN_DAYS else None,
        ))
    return [
        {"icon": icon, "label": label, "value": value, "tone": tone}
        for icon, label, value, tone in raw if value
    ]


def days_since(day_iso: str | None, tz_str: str | None) -> int | None:
    """Сколько дней прошло с даты последней тренировки В ЧАСОВОМ ПОЯСЕ ИГРОКА.

    Считать по серверной дате нельзя: наставник и игрок могут быть в разных
    поясах, и «сегодня» игрока превратилось бы во «вчера» на экране наставника.
    """
    if not day_iso:
        return None
    try:
        last = date.fromisoformat(str(day_iso)[:10])
    except ValueError:
        return None
    today = datetime.now(sched_svc.get_tz(tz_str)).date()
    return max(0, (today - last).days)


def slots_for_tier(tier: str | None) -> int:
    return SHELF_SLOTS_BY_TIER.get(tier or "standard", SHELF_SLOTS_BY_TIER["standard"])


async def price_limits(db) -> tuple[int, int]:
    """Админ-лимиты цены лота полки (app_shop_items key='shelf_lot')."""
    try:
        res = await (
            db.table("app_shop_items")
            .select("price_drops, is_active, meta")
            .eq("key", "shelf_lot")
            .maybe_single()
            .execute()
        )
        row = res.data if (res and res.data) else None
    except Exception as e:
        logger.warning("[shelf] price_limits read failed: %s", e)
        row = None
    if not row or not row.get("is_active"):
        return PRICE_MIN_DEFAULT, PRICE_MAX_DEFAULT
    meta = row.get("meta") or {}
    lo = int(meta.get("min") or row.get("price_drops") or PRICE_MIN_DEFAULT)
    hi = int(meta.get("max") or PRICE_MAX_DEFAULT)
    return (lo, hi) if lo <= hi else (PRICE_MIN_DEFAULT, PRICE_MAX_DEFAULT)


async def used_slots(db, partnership_id: str) -> int:
    res = await (
        db.table("shelf_items")
        .select("id")
        .eq("partnership_id", partnership_id)
        .in_("status", list(OCCUPYING_STATUSES))
        .execute()
    )
    return len(res.data or [])


async def reputation(db, partnership_id: str) -> tuple[int, int]:
    """Репутация наставника: (сколько обещаний исполнено, на сколько капель).
    Живой агрегат, НЕ денормализуем. 8d.1 (Д3): в шапке полки главной цифрой
    идёт СЧЁТ обещаний, сумма капель — расшифровкой под ним."""
    res = await (
        db.table("shelf_items")
        .select("price_drops")
        .eq("partnership_id", partnership_id)
        .eq("type", "promise")
        .in_("status", ["fulfilled", "archived"])
        .execute()
    )
    rows = res.data or []
    return len(rows), sum(int(r.get("price_drops") or 0) for r in rows)


async def occupied_counts(db, partnership_ids: list[str]) -> dict[str, int]:
    """partnership_id → сколько слотов полки занято (счётчик «🎁 X/N» в строке Market).

    8d.1a: строка каждого куба отражает роль куба — Market показывает СОСТОЯНИЕ
    ПОЛКИ, поэтому счётчик занятости нужен уже в списке, до захода на полку."""
    if not partnership_ids:
        return {}
    res = await (
        db.table("shelf_items")
        .select("partnership_id")
        .in_("partnership_id", partnership_ids)
        .in_("status", list(OCCUPYING_STATUSES))
        .execute()
    )
    out: dict[str, int] = {}
    for r in (res.data or []):
        pid = str(r["partnership_id"])
        out[pid] = out.get(pid, 0) + 1
    return out


async def pending_counts(db, partnership_ids: list[str]) -> dict[str, int]:
    """partnership_id → число купленных, но не исполненных обещаний (бейдж «⏳ N»)."""
    if not partnership_ids:
        return {}
    res = await (
        db.table("shelf_items")
        .select("partnership_id")
        .in_("partnership_id", partnership_ids)
        .eq("type", "promise")
        .eq("status", "purchased")
        .execute()
    )
    out: dict[str, int] = {}
    for r in (res.data or []):
        pid = str(r["partnership_id"])
        out[pid] = out.get(pid, 0) + 1
    return out


# ---------------------------------------------------------------------------
# Storage (приватный бакет)
# ---------------------------------------------------------------------------

_MIME_EXT = {"video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov"}


def normalize_mime(raw: str | None) -> str:
    """Браузеры шлют 'video/webm;codecs=vp9,opus' или 'video/mp4;codecs=avc1'.
    Бакет promises принимает только базовые типы — режем параметры и валидируем.
    Неизвестное считаем webm (MediaRecorder по умолчанию отдаёт его)."""
    base = (raw or "").split(";")[0].strip().lower()
    return base if base in PROMISE_MIMES else "video/webm"


def promise_path(partnership_id: str, kind: str, mime: str | None = None) -> str:
    ext = _MIME_EXT.get(normalize_mime(mime), "webm")
    return f"{partnership_id}/{kind}_{uuid.uuid4().hex}.{ext}"


async def upload_promise_video(db, path: str, payload: bytes, mime: str) -> None:
    await db.storage.from_(PROMISE_BUCKET).upload(
        path=path,
        file=payload,
        file_options={"content-type": mime, "x-upsert": "true"},
    )


async def signed_video_url(db, path: str | None, ttl: int = SIGNED_URL_TTL_SEC) -> str | None:
    """Подписанная ссылка на приватное видео. None — если файла нет/ошибка."""
    if not path:
        return None
    try:
        res: Any = await db.storage.from_(PROMISE_BUCKET).create_signed_url(path, ttl)
    except Exception as e:
        logger.warning("[shelf] signed url failed path=%s: %s", path, e)
        return None
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
    return None


async def remove_promise_videos(db, paths: list[str]) -> bool:
    paths = [p for p in paths if p]
    if not paths:
        return True
    try:
        await db.storage.from_(PROMISE_BUCKET).remove(paths)
        return True
    except Exception as e:
        logger.warning("[shelf] storage remove failed %s: %s", paths, e)
        return False

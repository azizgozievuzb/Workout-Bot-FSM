"""XP и уровни (S67) — единственный источник правды по лестнице.

Все семь чисел экономики живут в `app_settings` и правятся из админки
(миграция 039). Хардкода в коде нет — здесь только ДЕФОЛТЫ на случай, если
строка настроек недоступна, и формулы.

Лестница:
    cost(N) = base × early^(N-1)                        при N <= boundary
    cost(N) = base × early^(boundary-1) × late^(N-boundary)  при N > boundary

Уровень игрока считается из ОДНОГО общего счётчика `player_stats.global_score`:
ничего не сгорает, экран показывает «X из cost(level+1)» — шкала визуально
обнуляется на каждом уровне, а счётчик остаётся один.

⚠️ Округление лестницы делает ТОЛЬКО бэкенд (Python round — «к чётному»;
JS Math.round округляет .5 вверх и разошёлся бы на единицу). Фронт и админский
предпросмотр получают уже посчитанные числа.
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

# Дефолты = решение юзера 02.09 (BACKLOG 2026-09-02 п.1-2).
DEFAULTS: dict = {
    "xp_mult_main": 0.1,
    "xp_mult_light": 0.1,
    "level_base": 500,
    "level_early_step": 1.25,
    "level_late_step": 2.0,
    "level_boundary": 3,
    "level_freeze_rewards": {"1": 1, "2": 2, "3": 3},
}

SETTINGS_COLS = (
    "xp_mult_main, xp_mult_light, level_base, level_early_step, "
    "level_late_step, level_boundary, level_freeze_rewards"
)

# Страховка от бесконечного цикла, если админ выставит шаг 1.0 (лестница без
# роста). Реальные уровни столько не живут: при дефолтах cost(60) ≈ 1e20.
MAX_LEVEL = 200


def _f(value, fallback: float) -> float:
    """NUMERIC из PostgREST приезжает то числом, то строкой — приводим явно."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def _i(value, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(fallback)


def normalize(row: dict | None) -> dict:
    """Строка app_settings → словарь настроек с дефолтами вместо дыр."""
    row = row or {}
    rewards = row.get("level_freeze_rewards")
    if not isinstance(rewards, dict):
        rewards = DEFAULTS["level_freeze_rewards"]
    return {
        "xp_mult_main": max(0.0, _f(row.get("xp_mult_main"), DEFAULTS["xp_mult_main"])),
        "xp_mult_light": max(0.0, _f(row.get("xp_mult_light"), DEFAULTS["xp_mult_light"])),
        "level_base": max(1, _i(row.get("level_base"), DEFAULTS["level_base"])),
        "level_early_step": max(1.0, _f(row.get("level_early_step"), DEFAULTS["level_early_step"])),
        "level_late_step": max(1.0, _f(row.get("level_late_step"), DEFAULTS["level_late_step"])),
        "level_boundary": max(1, _i(row.get("level_boundary"), DEFAULTS["level_boundary"])),
        "level_freeze_rewards": {str(k): _i(v, 0) for k, v in rewards.items()},
    }


# Кэш настроек (TTL 60 c). Их читает КАЖДЫЙ /stats/me — самый горячий эндпоинт
# игрока, а один поход Railway→Supabase стоит ≈0.5 с (замер S66). Числа меняет
# только админ, поэтому минута расхождения безопасна; PATCH зовёт invalidate().
_CACHE: dict = {}
_CACHE_TTL = 60.0


def invalidate_cache() -> None:
    _CACHE.clear()


async def get_settings(db) -> dict:
    """Настройки XP из app_settings (id=1), с кэшом. Ошибка → дефолты."""
    now = time.monotonic()
    if _CACHE.get("_ts", 0.0) + _CACHE_TTL > now and "data" in _CACHE:
        return _CACHE["data"]
    try:
        res = await (
            db.table("app_settings").select(SETTINGS_COLS).eq("id", 1).maybe_single().execute()
        )
        data = normalize(res.data if res else None)
    except Exception as e:  # настройки не должны валить тренировку
        logger.warning("[leveling] settings read failed → defaults: %s", e)
        data = normalize(None)
    _CACHE["data"] = data
    _CACHE["_ts"] = now
    return data


def xp_for_session(total_score: int, session_type: str, s: dict) -> int:
    """XP за сессию = round(сумма баллов Gemini × множитель типа)."""
    mult = s["xp_mult_light"] if session_type == "light" else s["xp_mult_main"]
    return max(0, round(max(0, int(total_score or 0)) * mult))


def level_cost(n: int, s: dict) -> int:
    """Стоимость взятия уровня n (n >= 1), в XP."""
    if n < 1:
        return 0
    b = s["level_boundary"]
    early = s["level_early_step"]
    base = s["level_base"]
    exp_early = (n - 1) if n <= b else (b - 1)
    raw = base * (early ** exp_early)
    if n > b:
        raw *= s["level_late_step"] ** (n - b)
    return max(1, int(round(raw)))


def level_from_xp(xp: int, s: dict) -> tuple[int, int, int]:
    """Общий XP → (уровень, XP внутри уровня, стоимость следующего уровня).

    Новый игрок — уровень 0; первый уровень берётся на level_base XP.
    """
    remaining = max(0, int(xp or 0))
    level = 0
    while level < MAX_LEVEL:
        cost = level_cost(level + 1, s)
        if remaining < cost:
            break
        remaining -= cost
        level += 1
    return level, remaining, level_cost(level + 1, s)


def freeze_reward(level: int, s: dict) -> int:
    """Разовая выдача заморозок за взятие уровня (0 — награды нет)."""
    return max(0, _i(s["level_freeze_rewards"].get(str(level)), 0))


def ladder_preview(s: dict, count: int = 10) -> list[dict]:
    """Первые `count` уровней: стоимость, кумулятив, награда — для админки."""
    out: list[dict] = []
    cumulative = 0
    for n in range(1, max(1, count) + 1):
        cost = level_cost(n, s)
        cumulative += cost
        out.append({
            "level": n,
            "cost": cost,
            "cumulative": cumulative,
            "freezes": freeze_reward(n, s),
        })
    return out

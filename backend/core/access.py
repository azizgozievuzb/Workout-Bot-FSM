"""Единый расчёт доступа/подписки (модель 7.5).

Источник доступа — users.subscription_expires_at Ответственного.
Ответственный/Админ: своя подписка. Игрок: подписка его Ответственного + grace 3 дня.
pricing_mode='free' → всегда active.

Используется и auth.py (пейволл/renewal), и deps.py (гейт запросов) — чтобы логика жила в одном месте.
"""
from datetime import datetime, timedelta, timezone

# Grace window (days) a Player keeps access after their Responsible's subscription lapses.
SUBSCRIPTION_GRACE_DAYS = 3


def parse_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


async def compute_access(db, user_data: dict, now: datetime) -> dict:
    """Возвращает dict(active, expires_at, tier, pricing_mode, branch).

    branch: 'responsible' (свой доступ / админ), 'player' (через Ответственного), 'none' (нет доступов).
    """
    user_uuid = user_data["id"]
    is_admin = bool(user_data.get("is_admin"))
    has_resp = bool(user_data.get("has_responsible_access"))
    has_player = bool(user_data.get("has_player_access"))

    if is_admin or has_resp:
        pricing_mode = user_data.get("pricing_mode")
        exp_raw = user_data.get("subscription_expires_at")
        exp_dt = parse_dt(exp_raw)
        active = is_admin or pricing_mode == "free" or (exp_dt is not None and exp_dt > now)
        return {
            "active": active,
            "expires_at": exp_raw,
            "tier": user_data.get("responsible_access_tier"),
            "pricing_mode": pricing_mode,
            "branch": "responsible",
        }

    if has_player:
        part_res = await (
            db.table("partnerships")
            .select("responsible_id")
            .eq("player_id", user_uuid)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if part_res.data:
            resp_res = await (
                db.table("users")
                .select("subscription_expires_at, pricing_mode, responsible_access_tier")
                .eq("id", part_res.data[0]["responsible_id"])
                .maybe_single()
                .execute()
            )
            rd = resp_res.data if resp_res else None
            if rd:
                pm = rd.get("pricing_mode")
                exp_raw = rd.get("subscription_expires_at")
                exp_dt = parse_dt(exp_raw)
                grace_cutoff = now - timedelta(days=SUBSCRIPTION_GRACE_DAYS)
                active = pm == "free" or (exp_dt is not None and exp_dt > grace_cutoff)
                return {
                    "active": active,
                    "expires_at": exp_raw,
                    "tier": rd.get("responsible_access_tier"),
                    "pricing_mode": pm,
                    "branch": "player",
                }
        return {"active": False, "expires_at": None, "tier": None, "pricing_mode": None, "branch": "player"}

    # Новый юзер без роли → пейволл (станет Ответственным после интро-оплаты).
    return {
        "active": False,
        "expires_at": None,
        "tier": None,
        "pricing_mode": user_data.get("pricing_mode"),
        "branch": "none",
    }

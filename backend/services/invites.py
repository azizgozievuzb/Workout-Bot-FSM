"""Invite links (task 7.5) — replace the P-code onboarding path.

A Responsible with an active subscription and a free tier slot creates an invite;
the invited person taps t.me/{BOT}?start=inv_{code}, which pairs by user_id.
"""
import secrets
import string
from datetime import datetime, timezone

from ..services.tier_pricing import TIER_PLAYER_LIMITS

_ALPHABET = string.ascii_uppercase + string.digits


def generate_invite_code() -> str:
    """10-char code (fits VARCHAR(16))."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(10))


def _parse_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


async def count_active_partnerships(db, responsible_id: str) -> int:
    res = await (
        db.table("partnerships").select("id", count="exact")
        .eq("responsible_id", responsible_id).eq("status", "active").execute()
    )
    return int(res.count or 0)


async def count_pending_invites(db, responsible_id: str) -> int:
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await (
        db.table("invites").select("id", count="exact")
        .eq("responsible_id", responsible_id)
        .is_("used_by", "null")
        .gt("expires_at", now_iso)
        .execute()
    )
    return int(res.count or 0)


async def accept_invite(db, code: str, telegram_id: int, first_name: str | None,
                        username: str | None) -> dict:
    """Pair an invited user with the Responsible. Returns {ok, reason?, responsible_name?}."""
    now = datetime.now(timezone.utc)
    inv_res = await db.table("invites").select("*").eq("code", code).maybe_single().execute()
    inv = inv_res.data if inv_res else None
    if not inv:
        return {"ok": False, "reason": "not_found"}
    if inv.get("used_by") or inv.get("used_at"):
        return {"ok": False, "reason": "used"}
    exp = _parse_dt(inv.get("expires_at"))
    if exp and exp <= now:
        return {"ok": False, "reason": "expired"}

    responsible_id = inv["responsible_id"]

    # Resolve / create the invited user.
    existing_res = await (
        db.table("users")
        .select("id, has_responsible_access, is_admin, has_player_access")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    existing = existing_res.data if existing_res else None
    if existing:
        player_id = existing["id"]
        is_dual = bool(existing.get("has_responsible_access") or existing.get("is_admin"))
    else:
        ins = await (
            db.table("users")
            .insert({
                "telegram_id": telegram_id,
                "first_name": first_name or "",
                "telegram_username": username,
                "role": "player",
                "primary_role": "player",
                "has_player_access": False,
                "onboarding_done": False,
            })
            .execute()
        )
        player_id = ins.data[0]["id"]
        is_dual = False

    if player_id == responsible_id:
        return {"ok": False, "reason": "self"}

    # Responsible tier + slot limit.
    resp_res = await (
        db.table("users")
        .select("first_name, responsible_access_tier")
        .eq("id", responsible_id)
        .maybe_single()
        .execute()
    )
    if not resp_res or not resp_res.data:
        return {"ok": False, "reason": "not_found"}
    tier = resp_res.data.get("responsible_access_tier") or "standard"
    responsible_name = resp_res.data.get("first_name") or "Наставник"

    # Already an active partner? Treat as success (burn the invite, no dupe).
    dup_res = await (
        db.table("partnerships").select("id")
        .eq("responsible_id", responsible_id).eq("player_id", player_id)
        .eq("status", "active").maybe_single().execute()
    )
    if dup_res and dup_res.data:
        await _mark_used(db, inv["id"], player_id, now)
        return {"ok": True, "responsible_name": responsible_name, "already": True}

    if await count_active_partnerships(db, responsible_id) >= TIER_PLAYER_LIMITS.get(tier, 1):
        return {"ok": False, "reason": "limit"}

    # Atomically burn the invite (guard against double-tap).
    if not await _mark_used(db, inv["id"], player_id, now):
        return {"ok": False, "reason": "used"}

    # Grant player access.
    player_update: dict = {
        "has_player_access": True,
        "player_access_tier": tier,
        "deactivated_at": None,
        "scheduled_deletion_at": None,
    }
    if not is_dual:
        player_update["primary_role"] = "player"
        player_update["role"] = "player"
    await db.table("users").update(player_update).eq("id", player_id).execute()

    # Create the (indefinite) partnership.
    pc = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    await (
        db.table("partnerships")
        .insert({
            "player_id": player_id,
            "responsible_id": responsible_id,
            "status": "active",
            "pairing_code": pc,
            "pair_code": pc,
        })
        .execute()
    )

    return {"ok": True, "responsible_name": responsible_name}


async def _mark_used(db, invite_id: str, player_id: str, now: datetime) -> bool:
    res = await (
        db.table("invites")
        .update({"used_by": player_id, "used_at": now.isoformat()})
        .eq("id", invite_id)
        .is_("used_by", "null")
        .execute()
    )
    return bool(res.data)

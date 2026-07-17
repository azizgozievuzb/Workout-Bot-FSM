"""/invites/* — Responsible creates/lists/deletes invite links (task 7.5)."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...core.config import settings
from ...core.deps import get_current_user
from ...db.client import get_supabase
from ...services.invites import (
    count_active_partnerships,
    count_pending_invites,
    generate_invite_code,
)
from ...services.tier_pricing import TIER_PLAYER_LIMITS

router = APIRouter(prefix="/invites", tags=["invites"])


class InviteOut(BaseModel):
    id: str
    code: str
    link: str
    status: str  # 'pending' | 'used' | 'expired'
    used_by_name: str | None = None
    expires_at: str | None = None
    created_at: str | None = None


def _link(code: str) -> str:
    return f"https://t.me/{settings.BOT_USERNAME}?start=inv_{code}"


async def _me(db, telegram_id: int) -> dict:
    res = await (
        db.table("users")
        .select("id, is_admin, has_responsible_access, pricing_mode, "
                "subscription_expires_at, responsible_access_tier")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    return res.data


def _subscription_active(u: dict, now: datetime) -> bool:
    if u.get("is_admin") or u.get("pricing_mode") == "free":
        return True
    exp = u.get("subscription_expires_at")
    if not exp:
        return False
    try:
        dt = datetime.fromisoformat(exp)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt > now
    except Exception:
        return False


@router.post("", response_model=InviteOut)
async def create_invite(current_user: dict = Depends(get_current_user)) -> InviteOut:
    db = await get_supabase()
    now = datetime.now(timezone.utc)
    u = await _me(db, current_user["telegram_id"])

    if not (u.get("has_responsible_access") or u.get("is_admin")):
        raise HTTPException(status_code=403, detail={"code": "NOT_RESPONSIBLE"})
    if not _subscription_active(u, now):
        raise HTTPException(status_code=403, detail={"code": "SUBSCRIPTION_INACTIVE"})

    tier = u.get("responsible_access_tier") or "standard"
    limit = TIER_PLAYER_LIMITS.get(tier, 1)
    used = await count_active_partnerships(db, u["id"]) + await count_pending_invites(db, u["id"])
    if used >= limit:
        raise HTTPException(status_code=409, detail={"code": "SLOT_FULL", "limit": limit})

    code = generate_invite_code()
    ins = await (
        db.table("invites")
        .insert({"code": code, "responsible_id": u["id"]})
        .execute()
    )
    row = ins.data[0]
    return InviteOut(
        id=str(row["id"]),
        code=code,
        link=_link(code),
        status="pending",
        expires_at=row.get("expires_at"),
        created_at=row.get("created_at"),
    )


@router.get("", response_model=list[InviteOut])
async def list_invites(current_user: dict = Depends(get_current_user)) -> list[InviteOut]:
    db = await get_supabase()
    now = datetime.now(timezone.utc)
    u = await _me(db, current_user["telegram_id"])

    res = await (
        db.table("invites")
        .select("id, code, used_by, used_at, expires_at, created_at")
        .eq("responsible_id", u["id"])
        .order("created_at", desc=True)
        .execute()
    )
    rows = res.data or []

    used_ids = [r["used_by"] for r in rows if r.get("used_by")]
    names: dict = {}
    if used_ids:
        nres = await db.table("users").select("id, first_name").in_("id", used_ids).execute()
        names = {u2["id"]: u2.get("first_name") for u2 in (nres.data or [])}

    out: list[InviteOut] = []
    for r in rows:
        if r.get("used_by"):
            status = "used"
        else:
            exp = r.get("expires_at")
            expired = False
            if exp:
                try:
                    dt = datetime.fromisoformat(exp)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    expired = dt <= now
                except Exception:
                    pass
            status = "expired" if expired else "pending"
        out.append(InviteOut(
            id=str(r["id"]),
            code=r["code"],
            link=_link(r["code"]),
            status=status,
            used_by_name=names.get(r.get("used_by")),
            expires_at=r.get("expires_at"),
            created_at=r.get("created_at"),
        ))
    return out


@router.delete("/{invite_id}")
async def delete_invite(invite_id: UUID, current_user: dict = Depends(get_current_user)) -> dict:
    db = await get_supabase()
    u = await _me(db, current_user["telegram_id"])

    res = await (
        db.table("invites")
        .delete()
        .eq("id", str(invite_id))
        .eq("responsible_id", u["id"])
        .is_("used_by", "null")
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail={"code": "INVITE_NOT_FOUND"})
    return {"deleted": True}

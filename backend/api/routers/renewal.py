"""Renewal request endpoints: Player asks Responsible to renew access."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/renewal", tags=["renewal"])

COOLDOWN_HOURS = 24


class RenewalRequestOut(BaseModel):
    id: UUID
    player_id: UUID
    player_name: str | None
    player_photo_url: str | None
    created_at: datetime


@router.post("/request", status_code=201)
async def create_request(user: dict = Depends(get_current_user)):
    """Player → Responsible: 'продли мне'. Cooldown 24h."""
    if user.get("role") != "player":
        raise HTTPException(status_code=403, detail="Only players can request renewal")

    db = await get_supabase()
    telegram_id = user["telegram_id"]

    user_res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", telegram_id)
        .single()
        .execute()
    )
    player_id = user_res.data["id"]

    pair_res = await (
        db.table("partnerships")
        .select("responsible_id")
        .eq("player_id", player_id)
        .eq("status", "active")
        .maybe_single()
        .execute()
    )
    if not pair_res or not pair_res.data or not pair_res.data.get("responsible_id"):
        raise HTTPException(status_code=404, detail="Не найден Ответственный")
    responsible_id = pair_res.data["responsible_id"]

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=COOLDOWN_HOURS)).isoformat()
    recent_res = await (
        db.table("renewal_requests")
        .select("id, created_at")
        .eq("player_id", player_id)
        .is_("resolved_at", "null")
        .gt("created_at", cutoff)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if recent_res.data:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "COOLDOWN",
                "created_at": recent_res.data[0]["created_at"],
                "message": "Вы уже отправили запрос. Попробуйте позже.",
            },
        )

    await (
        db.table("renewal_requests")
        .insert({
            "player_id": player_id,
            "responsible_id": responsible_id,
        })
        .execute()
    )

    return {"status": "sent"}


@router.get("/my-requests", response_model=list[RenewalRequestOut])
async def list_my_requests(user: dict = Depends(get_current_user)):
    """Responsible видит неразрешённые запросы от своих Игроков."""
    if user.get("role") not in ("responsible", "admin"):
        return []

    db = await get_supabase()
    telegram_id = user["telegram_id"]

    user_res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", telegram_id)
        .single()
        .execute()
    )
    responsible_id = user_res.data["id"]

    req_res = await (
        db.table("renewal_requests")
        .select("id, player_id, created_at")
        .eq("responsible_id", responsible_id)
        .is_("resolved_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    rows = req_res.data or []
    if not rows:
        return []

    player_ids = list({r["player_id"] for r in rows})
    players_res = await (
        db.table("users")
        .select("id, first_name, profile_photo_url")
        .in_("id", player_ids)
        .execute()
    )
    players_by_id = {p["id"]: p for p in (players_res.data or [])}

    out: list[RenewalRequestOut] = []
    for r in rows:
        p = players_by_id.get(r["player_id"], {})
        out.append(RenewalRequestOut(
            id=r["id"],
            player_id=r["player_id"],
            player_name=p.get("first_name"),
            player_photo_url=p.get("profile_photo_url"),
            created_at=r["created_at"],
        ))
    return out

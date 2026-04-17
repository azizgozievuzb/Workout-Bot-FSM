"""
/partnerships/* — REST API для Mini App.
Mini App вызывает эти endpoints напрямую (не через бота).
"""
import math
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase
from ...services.fsm.onboarding_fsm import OnboardingService

router = APIRouter(prefix="/partnerships", tags=["partnerships"])


class MyPlayerOut(BaseModel):
    id: UUID
    telegram_id: int
    first_name: str | None
    profile_photo_url: str | None
    access_tier: str
    days_left: int | None
    is_deactivated: bool


class PairingCodeResponse(BaseModel):
    pairing_code: str


class AcceptCodeRequest(BaseModel):
    code: str


class PartnerInfo(BaseModel):
    telegram_id: int
    first_name: str | None
    telegram_username: str | None
    role: str
    profile_photo_url: str | None


@router.post("/create-code", response_model=PairingCodeResponse)
async def create_pairing_code(
    current_user: dict = Depends(get_current_user),
) -> PairingCodeResponse:
    """
    Player генерирует pairing code.
    Если код уже существует (pending) — возвращает существующий.
    """
    if current_user["role"] != "player":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only players can create codes")

    db = await get_supabase()

    # Ищем user.id
    user_res = (
        await db.table("users")
        .select("id")
        .eq("telegram_id", current_user["telegram_id"])
        .single()
        .execute()
    )
    user_id = user_res.data["id"]

    # Проверяем — нет ли уже pending кода
    existing = (
        await db.table("partnerships")
        .select("pairing_code")
        .eq("player_id", user_id)
        .eq("status", "pending")
        .execute()
    )
    if existing.data:
        return PairingCodeResponse(pairing_code=existing.data[0]["pairing_code"])

    svc = OnboardingService(db)
    code = await svc.generate_pairing_code(current_user["telegram_id"])
    return PairingCodeResponse(pairing_code=code)


@router.post("/accept-code")
async def accept_pairing_code(
    body: AcceptCodeRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Responsible вводит код игрока."""
    if current_user["role"] != "responsible":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only responsible can accept codes")

    db = await get_supabase()
    svc = OnboardingService(db)
    success = await svc.accept_pairing_code(current_user["telegram_id"], body.code)

    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Code not found or already used")

    return {"status": "paired"}


@router.get("/my-partner", response_model=PartnerInfo | None)
async def get_my_partner(
    current_user: dict = Depends(get_current_user),
) -> PartnerInfo | None:
    """Получить данные партнёра (Player → Responsible или Responsible → Player)."""
    db = await get_supabase()

    user_res = (
        await db.table("users")
        .select("id, role")
        .eq("telegram_id", current_user["telegram_id"])
        .single()
        .execute()
    )
    user = user_res.data

    if user["role"] == "player":
        pair_res = (
            await db.table("partnerships")
            .select("responsible_id")
            .eq("player_id", user["id"])
            .eq("status", "active")
            .single()
            .execute()
        )
        if not pair_res.data or not pair_res.data.get("responsible_id"):
            return None
        partner_id = pair_res.data["responsible_id"]
    else:
        # Responsible: берём первого активного игрока (позже — список)
        pair_res = (
            await db.table("partnerships")
            .select("player_id")
            .eq("responsible_id", user["id"])
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not pair_res.data:
            return None
        partner_id = pair_res.data[0]["player_id"]

    partner_res = (
        await db.table("users")
        .select("telegram_id, first_name, telegram_username, role, profile_photo_url")
        .eq("id", partner_id)
        .single()
        .execute()
    )
    return PartnerInfo(**partner_res.data)


@router.get("/my-players", response_model=list[MyPlayerOut])
async def my_players(current_user: dict = Depends(get_current_user)) -> list[MyPlayerOut]:
    """Responsible получает свой список Игроков + access_tier + days_left."""
    if current_user["role"] not in ("responsible", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Responsible only")

    db = await get_supabase()

    me_res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", current_user["telegram_id"])
        .single()
        .execute()
    )
    responsible_id = me_res.data["id"]

    pair_res = await (
        db.table("partnerships")
        .select("player_id")
        .eq("responsible_id", responsible_id)
        .eq("status", "active")
        .execute()
    )
    player_ids = [p["player_id"] for p in (pair_res.data or []) if p.get("player_id")]
    if not player_ids:
        return []

    users_res = await (
        db.table("users")
        .select("id, telegram_id, first_name, profile_photo_url, access_tier, deactivated_at")
        .in_("id", player_ids)
        .execute()
    )
    users_rows = users_res.data or []
    tg_ids = [u["telegram_id"] for u in users_rows]

    promos_res = await (
        db.table("promo_codes")
        .select("activated_by, expires_at, activated_at")
        .eq("code_type", "player")
        .eq("is_used", True)
        .in_("activated_by", tg_ids)
        .execute()
    )
    # Pick latest activation per player
    latest_by_tg: dict[int, dict] = {}
    for row in (promos_res.data or []):
        tg = row.get("activated_by")
        if tg is None:
            continue
        prev = latest_by_tg.get(tg)
        if not prev:
            latest_by_tg[tg] = row
            continue
        a = row.get("activated_at") or row.get("expires_at") or ""
        b = prev.get("activated_at") or prev.get("expires_at") or ""
        if a > b:
            latest_by_tg[tg] = row

    now = datetime.now(timezone.utc)
    out: list[MyPlayerOut] = []
    for u in users_rows:
        tg = u["telegram_id"]
        days_left: int | None = None
        promo = latest_by_tg.get(tg)
        if promo and promo.get("expires_at"):
            try:
                exp = datetime.fromisoformat(promo["expires_at"])
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                delta = exp - now
                days_left = max(0, math.ceil(delta.total_seconds() / 86400))
            except Exception:
                days_left = None

        out.append(MyPlayerOut(
            id=u["id"],
            telegram_id=tg,
            first_name=u.get("first_name"),
            profile_photo_url=u.get("profile_photo_url"),
            access_tier=u.get("access_tier") or "standard",
            days_left=days_left,
            is_deactivated=bool(u.get("deactivated_at")),
        ))
    return out

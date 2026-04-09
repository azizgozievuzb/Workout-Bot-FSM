"""
/partnerships/* — REST API для Mini App.
Mini App вызывает эти endpoints напрямую (не через бота).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase
from ...services.fsm.onboarding_fsm import OnboardingService

router = APIRouter(prefix="/partnerships", tags=["partnerships"])


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

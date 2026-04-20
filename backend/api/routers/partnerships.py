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
from ...services.notifications import emit_notification

router = APIRouter(prefix="/partnerships", tags=["partnerships"])


class MyPlayerOut(BaseModel):
    partnership_id: UUID
    id: UUID  # player user_id
    telegram_id: int
    first_name: str | None
    profile_photo_url: str | None
    access_tier: str
    expires_at: str | None
    is_expired: bool
    days_left: int | None
    days_since_expired: int | None
    is_deactivated: bool


class DeletePartnershipResp(BaseModel):
    deleted: bool
    player_hard_deleted: bool


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
    """Responsible получает свой список Игроков (active + expired) с TTL из partnerships.expires_at."""
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
        .select("id, player_id, expires_at")
        .eq("responsible_id", responsible_id)
        .execute()
    )
    pair_rows = [p for p in (pair_res.data or []) if p.get("player_id")]
    if not pair_rows:
        return []

    player_ids = [p["player_id"] for p in pair_rows]

    users_res = await (
        db.table("users")
        .select("id, telegram_id, first_name, profile_photo_url, player_access_tier, deactivated_at")
        .in_("id", player_ids)
        .execute()
    )
    users_by_id = {u["id"]: u for u in (users_res.data or [])}

    now = datetime.now(timezone.utc)
    out: list[MyPlayerOut] = []
    for p in pair_rows:
        u = users_by_id.get(p["player_id"])
        if not u:
            continue

        exp_raw = p.get("expires_at")
        exp: datetime | None = None
        if exp_raw:
            try:
                exp = datetime.fromisoformat(exp_raw)
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
            except Exception:
                exp = None

        if exp is None or exp <= now:
            is_expired = True
            days_left = None
            days_since_expired = (
                max(0, math.ceil((now - exp).total_seconds() / 86400))
                if exp is not None else None
            )
        else:
            is_expired = False
            days_left = max(0, math.ceil((exp - now).total_seconds() / 86400))
            days_since_expired = None

        out.append(MyPlayerOut(
            partnership_id=p["id"],
            id=u["id"],
            telegram_id=u["telegram_id"],
            first_name=u.get("first_name"),
            profile_photo_url=u.get("profile_photo_url"),
            access_tier=u.get("player_access_tier") or "standard",
            expires_at=exp_raw,
            is_expired=is_expired,
            days_left=days_left,
            days_since_expired=days_since_expired,
            is_deactivated=bool(u.get("deactivated_at")),
        ))

    def sort_key(row: MyPlayerOut):
        if not row.is_expired:
            # active first: больше days_left → выше
            return (0, -(row.days_left or 0))
        # expired: недавно истёкший (меньше days_since_expired) → выше
        return (1, row.days_since_expired if row.days_since_expired is not None else 10**9)

    out.sort(key=sort_key)
    return out


@router.delete("/{partnership_id}", response_model=DeletePartnershipResp)
async def delete_partnership(
    partnership_id: UUID,
    current_user: dict = Depends(get_current_user),
) -> DeletePartnershipResp:
    """Responsible удаляет партнёрство. Cascade-чистка «одиночного» Player-а."""
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
    me_id = me_res.data["id"]

    pair_res = await (
        db.table("partnerships")
        .select("id, responsible_id, player_id")
        .eq("id", str(partnership_id))
        .execute()
    )
    pair_rows = pair_res.data or []
    if not pair_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "PARTNERSHIP_NOT_FOUND"})
    pair = pair_rows[0]

    if pair["responsible_id"] != me_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "NOT_YOUR_PARTNERSHIP"})

    player_id = pair["player_id"]

    await emit_notification(
        db,
        user_id=player_id,
        type="partnership_deleted",
        title="🚪 Партнёрство завершено",
        message="Ответственный удалил ваше партнёрство.",
        payload={"responsible_id": me_id},
    )

    await (
        db.table("partnerships")
        .delete()
        .eq("id", str(partnership_id))
        .eq("responsible_id", me_id)
        .execute()
    )

    remaining_res = await (
        db.table("partnerships")
        .select("id", count="exact")
        .eq("player_id", player_id)
        .execute()
    )
    remaining = remaining_res.count if remaining_res.count is not None else len(remaining_res.data or [])

    player_hard_deleted = False
    if remaining == 0:
        user_res = await (
            db.table("users")
            .select("id, is_admin, has_responsible_access")
            .eq("id", player_id)
            .single()
            .execute()
        )
        u = user_res.data or {}
        if not u.get("is_admin") and not u.get("has_responsible_access"):
            await db.table("users").delete().eq("id", player_id).execute()
            player_hard_deleted = True
        else:
            await (
                db.table("users")
                .update({"has_player_access": False, "player_access_tier": None})
                .eq("id", player_id)
                .execute()
            )

    return DeletePartnershipResp(deleted=True, player_hard_deleted=player_hard_deleted)

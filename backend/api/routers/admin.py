"""Admin-only endpoints: create/list promo codes."""
import string
from random import choices

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/admin/promo", tags=["admin"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreatePromoRequest(BaseModel):
    tier: str = "basic"  # basic | premium
    count: int = 1


class CreatePromoResponse(BaseModel):
    codes: list[str]


class PromoCodeInfo(BaseModel):
    id: str
    code: str
    code_type: str
    tier: str
    is_used: bool
    used_by: str | None = None
    responsible_id: str | None = None
    created_at: str | None = None


class ListPromoResponse(BaseModel):
    codes: list[PromoCodeInfo]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_responsible_code() -> str:
    """Format: R-XXXXXX (6 uppercase chars)."""
    alphabet = string.ascii_uppercase + string.digits
    return "R-" + "".join(choices(alphabet, k=6))


async def _require_admin(current_user: dict):
    db = await get_supabase()
    user_res = await (
        db.table("users")
        .select("is_admin")
        .eq("telegram_id", current_user["telegram_id"])
        .single()
        .execute()
    )
    if not user_res.data.get("is_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


# ---------------------------------------------------------------------------
# POST /admin/promo/create
# ---------------------------------------------------------------------------

@router.post("/create", response_model=CreatePromoResponse)
async def create_promo(
    body: CreatePromoRequest,
    current_user: dict = Depends(get_current_user),
):
    await _require_admin(current_user)

    if body.tier not in ("basic", "premium"):
        raise HTTPException(status_code=400, detail="tier must be 'basic' or 'premium'")
    if body.count < 1 or body.count > 50:
        raise HTTPException(status_code=400, detail="count must be 1-50")

    db = await get_supabase()
    codes: list[str] = []

    for _ in range(body.count):
        code = _generate_responsible_code()
        await (
            db.table("promo_codes")
            .insert({
                "code": code,
                "code_type": "responsible",
                "tier": body.tier,
                "is_used": False,
            })
            .execute()
        )
        codes.append(code)

    return CreatePromoResponse(codes=codes)


# ---------------------------------------------------------------------------
# GET /admin/promo/list
# ---------------------------------------------------------------------------

@router.get("/list", response_model=ListPromoResponse)
async def list_promos(
    code_type: str | None = None,
    is_used: bool | None = None,
    tier: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    await _require_admin(current_user)

    db = await get_supabase()
    query = db.table("promo_codes").select(
        "id, code, code_type, tier, is_used, used_by, responsible_id, created_at"
    )

    if code_type:
        query = query.eq("code_type", code_type)
    if is_used is not None:
        query = query.eq("is_used", is_used)
    if tier:
        query = query.eq("tier", tier)

    query = query.order("created_at", desc=True)
    res = await query.execute()

    return ListPromoResponse(
        codes=[PromoCodeInfo(**row) for row in res.data]
    )

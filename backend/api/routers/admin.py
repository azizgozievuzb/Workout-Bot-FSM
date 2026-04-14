"""Admin-only endpoints: create/list promo codes."""
import string
from random import choices

from aiogram import Router as AiogramRouter, types, F
from aiogram.filters import Command
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/admin/promo", tags=["admin"])
general_router = APIRouter(prefix="/admin", tags=["admin"])

# Bot router for admin promo creation via Telegram
admin_bot_router = AiogramRouter(name="admin_promo")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreatePromoRequest(BaseModel):
    tier: str = "basic"       # basic | premium
    count: int = 1
    duration_days: int = 30   # 7 | 30 | 90


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
    duration_days: int | None = None


class ListPromoResponse(BaseModel):
    codes: list[PromoCodeInfo]


class PlayerInPair(BaseModel):
    telegram_id: int
    display_name: str | None
    username: str | None
    is_deactivated: bool

class ResponsibleGroup(BaseModel):
    telegram_id: int
    display_name: str | None
    username: str | None
    players: list[PlayerInPair]

class ConnectionsResponse(BaseModel):
    groups: list[ResponsibleGroup]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_responsible_code() -> str:
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
    if body.duration_days not in (7, 30, 90):
        raise HTTPException(status_code=400, detail="duration_days must be 7, 30 or 90")

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
                "duration_days": body.duration_days,
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
        "id, code, code_type, tier, is_used, used_by, responsible_id, created_at, duration_days"
    )

    # Admin panel shows only responsible-type codes by default.
    # Player invite codes (auto-generated for Responsibles) are excluded
    # unless explicitly requested via ?code_type=player.
    query = query.eq("code_type", code_type if code_type else "responsible")
    if is_used is not None:
        query = query.eq("is_used", is_used)
    if tier:
        query = query.eq("tier", tier)

    query = query.order("created_at", desc=True)
    res = await query.execute()

    return ListPromoResponse(
        codes=[PromoCodeInfo(**row) for row in res.data]
    )


# ---------------------------------------------------------------------------
# GET /admin/connections
# ---------------------------------------------------------------------------

@general_router.get("/connections", response_model=ConnectionsResponse, tags=["admin"])
async def get_connections(current_user: dict = Depends(get_current_user)):
    await _require_admin(current_user)
    db = await get_supabase()

    resp_res = await (
        db.table("users")
        .select("id, telegram_id, display_name, username")
        .eq("role", "responsible")
        .execute()
    )
    responsibles = resp_res.data or []

    groups = []
    for r in responsibles:
        pair_res = await (
            db.table("partnerships")
            .select("player_id")
            .eq("responsible_id", r["id"])
            .execute()
        )
        player_ids = [p["player_id"] for p in (pair_res.data or [])]

        players = []
        if player_ids:
            pl_res = await (
                db.table("users")
                .select("telegram_id, display_name, username, deactivated_at")
                .in_("id", player_ids)
                .execute()
            )
            for pl in (pl_res.data or []):
                players.append(PlayerInPair(
                    telegram_id=pl["telegram_id"],
                    display_name=pl.get("display_name"),
                    username=pl.get("username"),
                    is_deactivated=bool(pl.get("deactivated_at")),
                ))

        groups.append(ResponsibleGroup(
            telegram_id=r["telegram_id"],
            display_name=r.get("display_name"),
            username=r.get("username"),
            players=players,
        ))

    return ConnectionsResponse(groups=groups)


# ---------------------------------------------------------------------------
# Bot handler: /new_promo — admin creates promo code via Telegram
# ---------------------------------------------------------------------------

def _duration_keyboard() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(inline_keyboard=[
        [
            types.InlineKeyboardButton(text="7 дней", callback_data="admin_promo_dur_7"),
            types.InlineKeyboardButton(text="30 дней", callback_data="admin_promo_dur_30"),
            types.InlineKeyboardButton(text="90 дней", callback_data="admin_promo_dur_90"),
        ]
    ])


@admin_bot_router.message(Command("new_promo"))
async def cmd_new_promo(message: types.Message) -> None:
    db = await get_supabase()
    user_res = await (
        db.table("users")
        .select("is_admin")
        .eq("telegram_id", message.from_user.id)
        .maybe_single()
        .execute()
    )
    if not user_res or not user_res.data or not user_res.data.get("is_admin"):
        await message.answer("⛔ Только для администраторов.")
        return

    await message.answer(
        "Выберите срок действия промокода для Ответственного:",
        reply_markup=_duration_keyboard(),
    )


@admin_bot_router.callback_query(F.data.startswith("admin_promo_dur_"))
async def cb_admin_promo_duration(callback: types.CallbackQuery) -> None:
    db = await get_supabase()
    user_res = await (
        db.table("users")
        .select("is_admin")
        .eq("telegram_id", callback.from_user.id)
        .maybe_single()
        .execute()
    )
    if not user_res or not user_res.data or not user_res.data.get("is_admin"):
        await callback.answer("⛔ Нет прав.", show_alert=True)
        return

    duration_days = int(callback.data.split("_")[-1])

    code = "R-" + "".join(choices(string.ascii_uppercase + string.digits, k=6))
    await (
        db.table("promo_codes")
        .insert({
            "code": code,
            "code_type": "responsible",
            "tier": "basic",
            "is_used": False,
            "duration_days": duration_days,
        })
        .execute()
    )

    await callback.message.edit_text(
        f"✅ Промокод создан!\n\n"
        f"<code>{code}</code>\n\n"
        f"Срок действия для Игрока: <b>{duration_days} дней</b>\n"
        f"Тип: Ответственный (basic)",
        parse_mode="HTML",
    )
    await callback.answer()

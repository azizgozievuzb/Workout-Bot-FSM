"""Admin-only endpoints: create/list promo codes."""
import string
from datetime import datetime, timedelta, timezone
from random import choices

from aiogram import Router as AiogramRouter, types, F
from aiogram.filters import Command
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from typing import Literal

from ...core.deps import get_current_user, require_admin
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


class CreateResponsibleCodeReq(BaseModel):
    access_tier: Literal['standard', 'premium', 'elite'] = 'standard'
    duration_days: Literal[7, 30, 90, 180]


class CreateResponsibleCodeResp(BaseModel):
    code: str
    expires_at: str | None = None


class CreateRenewalCodeReq(BaseModel):
    access_tier: Literal['standard', 'premium', 'elite']
    duration_days: Literal[7, 30, 90, 180]


class CreateRenewalCodeResp(BaseModel):
    code: str


class PlayerStats(BaseModel):
    workouts_done: int
    stars_balance: int
    last_workout_at: str | None
    completion_rate: float


class ResponsibleStats(BaseModel):
    total_workouts: int
    active_players: int
    total_stars_earned: int
    avg_completion_rate: float


class PlayerInPair(BaseModel):
    id: str
    telegram_id: int
    display_name: str | None
    username: str | None
    is_deactivated: bool
    is_banned: bool
    ban_until: str | None
    stats: PlayerStats | None = None


class ResponsibleGroup(BaseModel):
    telegram_id: int
    display_name: str | None
    username: str | None
    players: list[PlayerInPair]
    stats: ResponsibleStats | None = None


class ConnectionsResponse(BaseModel):
    groups: list[ResponsibleGroup]


class BatchBuyReq(BaseModel):
    code_type: Literal['responsible', 'player', 'renewal']
    tier: Literal['standard', 'premium', 'elite'] = 'standard'
    duration: Literal[7, 30, 90, 180] = 30
    count: int = Field(ge=1, le=50, default=1)


class BatchBuyResp(BaseModel):
    codes: list[str]
    total_stars_cost: int


class BanHistoryEntry(BaseModel):
    id: str
    user_id: str
    display_name: str | None
    telegram_id: int
    banned_at: str
    ban_until: str
    reason: str
    missed_workouts: int
    is_active: bool
    unbanned_early: bool


class BanHistoryResponse(BaseModel):
    bans: list[BanHistoryEntry]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TIER_LETTER: dict[str, str] = {"standard": "S", "premium": "P", "elite": "E"}


def _gen_prefixed(role_letter: str, access_tier: str) -> str:
    """8-char code: <role_letter><tier_letter><6 random>. Used for R/P codes."""
    alphabet = string.ascii_uppercase + string.digits
    tl = _TIER_LETTER.get(access_tier, "S")
    return f"{role_letter}{tl}" + "".join(choices(alphabet, k=6))


def _gen_renewal(access_tier: str) -> str:
    """Renewal code (given by Admin to Responsible, applied to a Player).
    Format: RN<tier_letter><5 random> → 8 chars total."""
    alphabet = string.ascii_uppercase + string.digits
    tl = _TIER_LETTER.get(access_tier, "S")
    return f"RN{tl}" + "".join(choices(alphabet, k=5))


def _generate_responsible_code() -> str:
    # Legacy basic-tier generator retained for back-compat (/admin/promo/create)
    return _gen_prefixed("R", "standard")


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
# POST /admin/promo/responsible  — create R-code with tier + duration
# ---------------------------------------------------------------------------

@router.post("/responsible", response_model=CreateResponsibleCodeResp)
async def create_responsible_code(
    body: CreateResponsibleCodeReq,
    admin: dict = Depends(require_admin),
):
    db = await get_supabase()
    # R-code format: R<tier_letter><6 random> (e.g. RE7FG2XB for Elite)
    code = _gen_prefixed("R", body.access_tier)
    await (
        db.table("promo_codes")
        .insert({
            "code": code,
            "code_type": "responsible",
            "tier": "basic",
            "access_tier": body.access_tier,
            "is_used": False,
            "duration_days": body.duration_days,
            "is_renewal": False,
        })
        .execute()
    )
    return CreateResponsibleCodeResp(code=code)


# ---------------------------------------------------------------------------
# POST /admin/promo/renewal  — create renewal P-code (for Responsible to give Player)
# ---------------------------------------------------------------------------

@router.post("/renewal", response_model=CreateRenewalCodeResp)
async def create_renewal_code(
    body: CreateRenewalCodeReq,
    admin: dict = Depends(require_admin),
):
    db = await get_supabase()
    import uuid as _uuid
    # Renewal code format: RN<tier_letter><5 random>
    code = _gen_renewal(body.access_tier)
    await (
        db.table("promo_codes")
        .insert({
            "code": code,
            "code_type": "player",
            "tier": "basic",
            "access_tier": body.access_tier,
            "is_used": False,
            "duration_days": body.duration_days,
            "is_renewal": True,
            "responsible_id": None,
            "deep_link_token": str(_uuid.uuid4()),
        })
        .execute()
    )
    return CreateRenewalCodeResp(code=code)


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
        .eq("has_responsible_access", True)
        .execute()
    )
    responsibles = resp_res.data or []

    if not responsibles:
        return ConnectionsResponse(groups=[])

    resp_ids = [r["id"] for r in responsibles]

    # Bulk fetch all partnerships for all responsibles
    pair_res = await (
        db.table("partnerships")
        .select("player_id, responsible_id")
        .in_("responsible_id", resp_ids)
        .execute()
    )
    all_partnerships = pair_res.data or []

    # Collect all unique player IDs
    all_player_ids = list({p["player_id"] for p in all_partnerships if p.get("player_id")})

    # Bulk fetch all players (including ban fields + created_at for completion_rate)
    players_by_id: dict = {}
    if all_player_ids:
        pl_res = await (
            db.table("users")
            .select("id, telegram_id, display_name, username, deactivated_at, ban_until, created_at")
            .in_("id", all_player_ids)
            .execute()
        )
        for pl in (pl_res.data or []):
            players_by_id[pl["id"]] = pl

    # Bulk fetch player_stats for all players (single query, no N+1)
    stats_by_id: dict = {}
    if all_player_ids:
        st_res = await (
            db.table("player_stats")
            .select("player_id, global_score, star_balance, last_workout_date")
            .in_("player_id", all_player_ids)
            .execute()
        )
        for st in (st_res.data or []):
            stats_by_id[st["player_id"]] = st

    # Group partnerships by responsible_id
    partnerships_by_resp: dict[str, list[str]] = {}
    for p in all_partnerships:
        partnerships_by_resp.setdefault(p["responsible_id"], []).append(p["player_id"])

    now = datetime.now(timezone.utc)

    def _compute_player_stats(pl: dict, st: dict | None) -> PlayerStats:
        workouts = st["global_score"] if st else 0
        stars = st["star_balance"] if st else 0
        last_raw = st["last_workout_date"] if st else None
        created_raw = pl.get("created_at")
        days_since_join = 1
        if created_raw:
            try:
                created = datetime.fromisoformat(created_raw)
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                days_since_join = max(1, (now - created).days)
            except Exception:
                pass
        rate = min(1.0, workouts / days_since_join)
        return PlayerStats(
            workouts_done=workouts,
            stars_balance=stars,
            last_workout_at=last_raw,
            completion_rate=round(rate, 3),
        )

    # Assemble response
    groups = []
    for r in responsibles:
        player_ids = partnerships_by_resp.get(r["id"], [])
        players = []
        for pid in player_ids:
            pl = players_by_id.get(pid)
            if pl:
                ban_until_raw = pl.get("ban_until")
                is_banned = False
                if ban_until_raw:
                    try:
                        ban_dt = datetime.fromisoformat(ban_until_raw)
                        if ban_dt.tzinfo is None:
                            ban_dt = ban_dt.replace(tzinfo=timezone.utc)
                        is_banned = ban_dt > now
                    except Exception:
                        pass
                pstats = _compute_player_stats(pl, stats_by_id.get(pid))
                players.append(PlayerInPair(
                    id=pl["id"],
                    telegram_id=pl["telegram_id"],
                    display_name=pl.get("display_name"),
                    username=pl.get("username"),
                    is_deactivated=bool(pl.get("deactivated_at")),
                    is_banned=is_banned,
                    ban_until=ban_until_raw if is_banned else None,
                    stats=pstats,
                ))

        active_count = sum(1 for p in players if not p.is_deactivated and not p.is_banned)
        total_workouts = sum(p.stats.workouts_done for p in players if p.stats)
        total_stars = sum(p.stats.stars_balance for p in players if p.stats)
        rates = [p.stats.completion_rate for p in players if p.stats]
        avg_rate = round(sum(rates) / len(rates), 3) if rates else 0.0

        groups.append(ResponsibleGroup(
            telegram_id=r["telegram_id"],
            display_name=r.get("display_name"),
            username=r.get("username"),
            players=players,
            stats=ResponsibleStats(
                total_workouts=total_workouts,
                active_players=active_count,
                total_stars_earned=total_stars,
                avg_completion_rate=avg_rate,
            ),
        ))

    return ConnectionsResponse(groups=groups)


# ---------------------------------------------------------------------------
# POST /admin/codes/batch-buy
# ---------------------------------------------------------------------------

def _generate_batch_code(code_type: str, access_tier: str) -> str:
    """Batch-code format matches the canonical prefix spec:
       R<tier>... | P<tier>... | RN<tier>... (tier letter = S/P/E)."""
    if code_type == 'responsible':
        return _gen_prefixed("R", access_tier)
    if code_type == 'renewal':
        return _gen_renewal(access_tier)
    return _gen_prefixed("P", access_tier)


@general_router.post("/codes/batch-buy", response_model=BatchBuyResp, tags=["admin"])
async def batch_buy_codes(body: BatchBuyReq, admin: dict = Depends(require_admin)):
    db = await get_supabase()
    codes: list[str] = []
    rows: list[dict] = []
    is_renewal = body.code_type == 'renewal'
    db_code_type = 'player' if is_renewal else body.code_type
    for _ in range(body.count):
        code = _generate_batch_code(body.code_type, body.tier)
        codes.append(code)
        rows.append({
            "code": code,
            "code_type": db_code_type,
            "tier": "basic",
            "access_tier": body.tier,
            "is_used": False,
            "duration_days": body.duration,
            "is_renewal": is_renewal,
        })
    await db.table("promo_codes").insert(rows).execute()
    return BatchBuyResp(codes=codes, total_stars_cost=0)


# ---------------------------------------------------------------------------
# GET /admin/bans/history
# ---------------------------------------------------------------------------

@general_router.get("/bans/history", response_model=BanHistoryResponse, tags=["admin"])
async def get_ban_history(admin: dict = Depends(require_admin)):
    db = await get_supabase()
    now = datetime.now(timezone.utc)
    thirty_days_ago = (now - timedelta(days=30)).isoformat()

    res = await (
        db.table("ban_history")
        .select("id, user_id, banned_at, ban_until, reason, missed_workouts, unbanned_early_at")
        .gte("banned_at", thirty_days_ago)
        .order("banned_at", desc=True)
        .limit(50)
        .execute()
    )
    records = res.data or []

    # Also include still-active bans older than 30 days
    active_old_res = await (
        db.table("ban_history")
        .select("id, user_id, banned_at, ban_until, reason, missed_workouts, unbanned_early_at")
        .lt("banned_at", thirty_days_ago)
        .gt("ban_until", now.isoformat())
        .is_("unbanned_early_at", "null")
        .limit(20)
        .execute()
    )
    records = records + (active_old_res.data or [])

    # Bulk-fetch user display info
    user_ids = list({r["user_id"] for r in records if r.get("user_id")})
    users_by_id: dict = {}
    if user_ids:
        u_res = await (
            db.table("users")
            .select("id, telegram_id, display_name")
            .in_("id", user_ids)
            .execute()
        )
        for u in (u_res.data or []):
            users_by_id[u["id"]] = u

    entries: list[BanHistoryEntry] = []
    for r in records:
        uid = r.get("user_id", "")
        u = users_by_id.get(uid, {})
        ban_until_raw = r["ban_until"]
        try:
            ban_dt = datetime.fromisoformat(ban_until_raw)
            if ban_dt.tzinfo is None:
                ban_dt = ban_dt.replace(tzinfo=timezone.utc)
            is_active = ban_dt > now and not r.get("unbanned_early_at")
        except Exception:
            is_active = False
        entries.append(BanHistoryEntry(
            id=r["id"],
            user_id=uid,
            display_name=u.get("display_name"),
            telegram_id=u.get("telegram_id", 0),
            banned_at=r["banned_at"],
            ban_until=ban_until_raw,
            reason=r["reason"],
            missed_workouts=r.get("missed_workouts", 0),
            is_active=is_active,
            unbanned_early=bool(r.get("unbanned_early_at")),
        ))

    return BanHistoryResponse(bans=entries)


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

    # Bot-generated R-code defaults to Standard tier (RS prefix)
    code = _gen_prefixed("R", "standard")
    await (
        db.table("promo_codes")
        .insert({
            "code": code,
            "code_type": "responsible",
            "tier": "basic",
            "access_tier": "standard",
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

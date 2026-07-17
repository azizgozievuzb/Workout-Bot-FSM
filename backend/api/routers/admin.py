"""Admin endpoints (7.5): connections overview, ban history, tier downgrade with eviction.

Coupons / tier-prices / user pricing overrides are added to these routers in Phase 6.
The legacy promo-code generation (R/renewal/bonus-pack/batch) was removed in 7.5.
"""
import secrets
import string
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from aiogram import Router as AiogramRouter
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ...core.deps import get_current_user, require_admin
from ...db.client import get_supabase

_CODE_ALPHABET = string.ascii_uppercase + string.digits

router = APIRouter(prefix="/admin", tags=["admin"])
general_router = APIRouter(prefix="/admin", tags=["admin"])

# Kept for main.py wiring; the /new_promo bot command was removed in 7.5.
admin_bot_router = AiogramRouter(name="admin")

_TIER_PLAYER_LIMITS: dict[str, int] = {"standard": 1, "premium": 2, "elite": 3}


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
# GET /admin/connections
# ---------------------------------------------------------------------------

class PlayerStats(BaseModel):
    workouts_done: int
    drops_balance: int
    last_workout_at: str | None
    completion_rate: float


class ResponsibleStats(BaseModel):
    total_workouts: int
    active_players: int
    total_xp_earned: int
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


@general_router.get("/connections", response_model=ConnectionsResponse, tags=["admin"])
async def get_connections(current_user: dict = Depends(get_current_user)):
    await _require_admin(current_user)
    db = await get_supabase()

    resp_res = await (
        db.table("users")
        .select("id, telegram_id, first_name, telegram_username")
        .eq("has_responsible_access", True)
        .execute()
    )
    responsibles = resp_res.data or []

    if not responsibles:
        return ConnectionsResponse(groups=[])

    resp_ids = [r["id"] for r in responsibles]

    pair_res = await (
        db.table("partnerships")
        .select("player_id, responsible_id")
        .in_("responsible_id", resp_ids)
        .execute()
    )
    all_partnerships = pair_res.data or []

    all_player_ids = list({p["player_id"] for p in all_partnerships if p.get("player_id")})

    players_by_id: dict = {}
    if all_player_ids:
        pl_res = await (
            db.table("users")
            .select("id, telegram_id, first_name, telegram_username, deactivated_at, ban_until, created_at")
            .in_("id", all_player_ids)
            .execute()
        )
        for pl in (pl_res.data or []):
            players_by_id[pl["id"]] = pl

    stats_by_id: dict = {}
    if all_player_ids:
        st_res = await (
            db.table("player_stats")
            .select("player_id, global_score, drops_balance, last_workout_date")
            .in_("player_id", all_player_ids)
            .execute()
        )
        for st in (st_res.data or []):
            stats_by_id[st["player_id"]] = st

    partnerships_by_resp: dict[str, list[str]] = {}
    for p in all_partnerships:
        partnerships_by_resp.setdefault(p["responsible_id"], []).append(p["player_id"])

    now = datetime.now(timezone.utc)

    def _compute_player_stats(pl: dict, st: dict | None) -> PlayerStats:
        workouts = st["global_score"] if st else 0
        stars = st["drops_balance"] if st else 0
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
            drops_balance=stars,
            last_workout_at=last_raw,
            completion_rate=round(rate, 3),
        )

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
                    display_name=pl.get("first_name"),
                    username=pl.get("telegram_username"),
                    is_deactivated=bool(pl.get("deactivated_at")),
                    is_banned=is_banned,
                    ban_until=ban_until_raw if is_banned else None,
                    stats=pstats,
                ))

        active_count = sum(1 for p in players if not p.is_deactivated and not p.is_banned)
        total_workouts = sum(p.stats.workouts_done for p in players if p.stats)
        total_xp = sum(p.stats.drops_balance for p in players if p.stats)
        rates = [p.stats.completion_rate for p in players if p.stats]
        avg_rate = round(sum(rates) / len(rates), 3) if rates else 0.0

        groups.append(ResponsibleGroup(
            telegram_id=r["telegram_id"],
            display_name=r.get("first_name"),
            username=r.get("telegram_username"),
            players=players,
            stats=ResponsibleStats(
                total_workouts=total_workouts,
                active_players=active_count,
                total_xp_earned=total_xp,
                avg_completion_rate=avg_rate,
            ),
        ))

    return ConnectionsResponse(groups=groups)


# ---------------------------------------------------------------------------
# GET /admin/bans/history
# ---------------------------------------------------------------------------

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

    user_ids = list({r["user_id"] for r in records if r.get("user_id")})
    users_by_id: dict = {}
    if user_ids:
        u_res = await (
            db.table("users")
            .select("id, telegram_id, first_name")
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
            display_name=u.get("first_name"),
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
# POST /admin/apply-tier-downgrade  — evict players + set tier (no promo codes, 7.5)
# ---------------------------------------------------------------------------

class TierDowngradeReq(BaseModel):
    target_tier: Literal["standard", "premium", "elite"]
    player_ids_to_evict: list[_uuid.UUID] = Field(default_factory=list)


class RemainingPlayer(BaseModel):
    id: str
    first_name: str | None = None


class TierDowngradeResp(BaseModel):
    evicted_count: int
    new_tier: str
    remaining_players: list[RemainingPlayer]


@general_router.post("/apply-tier-downgrade", response_model=TierDowngradeResp)
async def apply_tier_downgrade(
    body: TierDowngradeReq,
    current_user: dict = Depends(get_current_user),
):
    role = current_user.get("role", "")
    if role not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail="Только для Ответственного или Админа")

    db = await get_supabase()
    user_res = await (
        db.table("users")
        .select("id, has_responsible_access")
        .eq("telegram_id", current_user["telegram_id"])
        .single()
        .execute()
    )
    user_id = user_res.data["id"]
    if not user_res.data.get("has_responsible_access"):
        raise HTTPException(status_code=403, detail="Нет доступа Ответственного")

    new_tier = body.target_tier
    max_players = _TIER_PLAYER_LIMITS.get(new_tier, 1)
    evict_ids = [str(pid) for pid in body.player_ids_to_evict]

    all_pairs_res = await (
        db.table("partnerships")
        .select("id, player_id")
        .eq("responsible_id", user_id)
        .eq("status", "active")
        .execute()
    )
    all_pairs = all_pairs_res.data or []
    remaining_after = len(all_pairs) - len(evict_ids)
    if remaining_after > max_players:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INSUFFICIENT_EVICTIONS",
                "required": len(all_pairs) - max_players,
                "provided": len(evict_ids),
            },
        )

    pair_player_ids = {p["player_id"] for p in all_pairs}
    for eid in evict_ids:
        if eid not in pair_player_ids:
            raise HTTPException(
                status_code=400,
                detail={"code": "PLAYER_NOT_IN_YOUR_TEAM", "player_id": eid},
            )

    evicted_count = 0
    for player_id in evict_ids:
        await (
            db.table("partnerships")
            .delete()
            .eq("responsible_id", user_id)
            .eq("player_id", player_id)
            .execute()
        )
        evicted_count += 1

        other_pairs_res = await (
            db.table("partnerships")
            .select("id", count="exact")
            .eq("player_id", player_id)
            .neq("responsible_id", user_id)
            .execute()
        )
        player_user_res = await (
            db.table("users")
            .select("has_responsible_access, is_admin")
            .eq("id", player_id)
            .maybe_single()
            .execute()
        )
        player_user = player_user_res.data if player_user_res else {}
        has_dual_role = player_user.get("has_responsible_access") or player_user.get("is_admin")
        has_other_partnerships = (other_pairs_res.count or 0) > 0

        if not has_dual_role and not has_other_partnerships:
            await db.table("player_stats").delete().eq("player_id", player_id).execute()
            await db.table("shop_items").delete().eq("player_id", player_id).execute()
            await db.table("boosts").delete().eq("player_id", player_id).execute()
            await db.table("workout_sessions").delete().eq("player_id", player_id).execute()

    await (
        db.table("users")
        .update({"responsible_access_tier": new_tier})
        .eq("id", user_id)
        .execute()
    )

    remaining_res = await (
        db.table("partnerships")
        .select("player_id")
        .eq("responsible_id", user_id)
        .eq("status", "active")
        .execute()
    )
    remaining_player_ids = [p["player_id"] for p in (remaining_res.data or [])]
    remaining_players_list: list[RemainingPlayer] = []
    if remaining_player_ids:
        rp_res = await (
            db.table("users")
            .select("id, first_name")
            .in_("id", remaining_player_ids)
            .execute()
        )
        remaining_players_list = [
            RemainingPlayer(id=r["id"], first_name=r.get("first_name"))
            for r in (rp_res.data or [])
        ]

    return TierDowngradeResp(
        evicted_count=evicted_count,
        new_tier=new_tier,
        remaining_players=remaining_players_list,
    )


# ===========================================================================
# Coupons — admin (7.5)
# ===========================================================================

class CouponRow(BaseModel):
    id: str
    code: str
    discount_pct: int
    is_active: bool
    max_uses: int | None = None
    used_count: int = 0
    expires_at: str | None = None
    created_at: str | None = None


class CreateCouponReq(BaseModel):
    code: str | None = None  # None → autogenerate
    discount_pct: int = Field(ge=1, le=99)
    max_uses: int | None = Field(default=None, ge=1)
    expires_at: str | None = None


class UpdateCouponReq(BaseModel):
    is_active: bool


@general_router.get("/coupons", response_model=list[CouponRow])
async def list_coupons(admin: dict = Depends(require_admin)):
    db = await get_supabase()
    res = await (
        db.table("coupons")
        .select("id, code, discount_pct, is_active, max_uses, used_count, expires_at, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    return [CouponRow(id=str(r["id"]), **{k: r[k] for k in r if k != "id"}) for r in (res.data or [])]


@general_router.post("/coupons", response_model=CouponRow)
async def create_coupon(body: CreateCouponReq, admin: dict = Depends(require_admin)):
    db = await get_supabase()
    code = (body.code or "").strip().upper() or "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))

    existing = await db.table("coupons").select("id").eq("code", code).maybe_single().execute()
    if existing and existing.data:
        raise HTTPException(status_code=409, detail={"code": "CODE_EXISTS"})

    ins = await (
        db.table("coupons")
        .insert({
            "code": code,
            "discount_pct": body.discount_pct,
            "max_uses": body.max_uses,
            "expires_at": body.expires_at,
            "is_active": True,
        })
        .execute()
    )
    if not ins.data:
        raise HTTPException(status_code=500, detail="Failed to create coupon")
    r = ins.data[0]
    return CouponRow(id=str(r["id"]), **{k: r[k] for k in r if k != "id"})


@general_router.patch("/coupons/{coupon_id}", response_model=CouponRow)
async def update_coupon(coupon_id: _uuid.UUID, body: UpdateCouponReq, admin: dict = Depends(require_admin)):
    db = await get_supabase()
    res = await (
        db.table("coupons")
        .update({"is_active": body.is_active})
        .eq("id", str(coupon_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Coupon not found")
    r = res.data[0]
    return CouponRow(id=str(r["id"]), **{k: r[k] for k in r if k != "id"})


# ===========================================================================
# Tier prices — admin (7.5)
# ===========================================================================

class TierPriceRow(BaseModel):
    tier: str
    intro_price_stars: int
    price_1m: int
    price_3m: int
    price_12m: int
    updated_at: str | None = None


class UpdateTierPriceReq(BaseModel):
    intro_price_stars: int | None = Field(default=None, ge=1)
    price_1m: int | None = Field(default=None, ge=1)
    price_3m: int | None = Field(default=None, ge=1)
    price_12m: int | None = Field(default=None, ge=1)


@general_router.get("/tier-prices", response_model=list[TierPriceRow])
async def list_tier_prices(admin: dict = Depends(require_admin)):
    db = await get_supabase()
    res = await (
        db.table("tier_prices")
        .select("tier, intro_price_stars, price_1m, price_3m, price_12m, updated_at")
        .execute()
    )
    order = {"standard": 0, "premium": 1, "elite": 2}
    rows = sorted(res.data or [], key=lambda r: order.get(r["tier"], 9))
    return [TierPriceRow(**r) for r in rows]


@general_router.patch("/tier-prices/{tier}", response_model=TierPriceRow)
async def update_tier_price(
    tier: Literal["standard", "premium", "elite"],
    body: UpdateTierPriceReq,
    admin: dict = Depends(require_admin),
):
    db = await get_supabase()
    update: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for col in ("intro_price_stars", "price_1m", "price_3m", "price_12m"):
        val = getattr(body, col)
        if val is not None:
            update[col] = val
    if len(update) == 1:
        raise HTTPException(status_code=400, detail="Nothing to update")

    res = await db.table("tier_prices").update(update).eq("tier", tier).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Tier not found")
    return TierPriceRow(**res.data[0])


# ===========================================================================
# User pricing override — admin (7.5)
# ===========================================================================

class UserPricingReq(BaseModel):
    mode: Literal["free", "custom"] | None = None  # null → обычный режим
    custom_price_stars: int | None = Field(default=None, ge=1)


class UserPricingResp(BaseModel):
    id: str
    pricing_mode: str | None = None
    custom_price_stars: int | None = None


@general_router.patch("/users/{user_id}/pricing", response_model=UserPricingResp)
async def set_user_pricing(user_id: _uuid.UUID, body: UserPricingReq, admin: dict = Depends(require_admin)):
    db = await get_supabase()
    if body.mode == "custom" and (body.custom_price_stars is None or body.custom_price_stars < 1):
        raise HTTPException(status_code=400, detail={"code": "CUSTOM_PRICE_REQUIRED"})

    update = {
        "pricing_mode": body.mode,
        "custom_price_stars": body.custom_price_stars if body.mode == "custom" else None,
    }
    res = await db.table("users").update(update).eq("id", str(user_id)).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    r = res.data[0]
    return UserPricingResp(
        id=str(r["id"]),
        pricing_mode=r.get("pricing_mode"),
        custom_price_stars=r.get("custom_price_stars"),
    )

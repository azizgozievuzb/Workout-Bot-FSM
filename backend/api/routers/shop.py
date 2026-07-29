"""Shop API — остаток легаси-магазина после 8d.

Легаси-лоты (`shop_items`), покупки (`purchases`) и бусты выпилены в 8d: полку
наставника заменили `shelf_items` (routers/shelf.py + player_shop.py).
Здесь живёт только дарение ЗАМОРОЗОК из пула Ответственного
(`users.gift_freeze_balance` → `player_stats.streak_freeze_balance`) — механика
осталась как есть, кнопка переехала на страницу игрока (§8.8).
"""
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.deps import get_current_user
from ...db.client import get_supabase
from ...services.notifications import emit_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shop", tags=["shop"])


class GiftFreezeReq(BaseModel):
    player_id: uuid.UUID
    freeze_count: int = Field(ge=1, le=50)
    message: str = Field(max_length=500, default="")


class GiftFreezeResp(BaseModel):
    gifted: int
    new_gift_freeze_balance: int
    new_player_streak_freeze_balance: int


async def _fetch_user_id(db, telegram_id: int) -> str:
    res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    return res.data["id"]


# ---------------------------------------------------------------------------
# POST /shop/gift-freeze
# ---------------------------------------------------------------------------

@router.post("/gift-freeze", response_model=GiftFreezeResp)
async def gift_freeze(
    body: GiftFreezeReq,
    user: dict = Depends(get_current_user),
):
    role = user.get("role", "")
    if role not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")

    db = await get_supabase()
    me_id = await _fetch_user_id(db, user["telegram_id"])
    target_player_id = str(body.player_id)

    # Живость пары — status='active' (partnerships.expires_at — легаси промо-эпохи,
    # у боевых пар NULL; тот же баг ловили в 8a-хотфиксе 7b31630).
    pair_res = await (
        db.table("partnerships")
        .select("id")
        .eq("responsible_id", me_id)
        .eq("player_id", target_player_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    if not pair_res.data:
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_PLAYER"})

    bal_res = await (
        db.table("users")
        .select("gift_freeze_balance")
        .eq("id", me_id)
        .single()
        .execute()
    )
    cur_gift = int(bal_res.data.get("gift_freeze_balance") or 0)
    if cur_gift < body.freeze_count:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INSUFFICIENT_GIFT_FREEZE",
                "have": cur_gift,
                "need": body.freeze_count,
            },
        )

    new_gift = cur_gift - body.freeze_count
    deduct_res = await (
        db.table("users")
        .update({"gift_freeze_balance": new_gift})
        .eq("id", me_id)
        .eq("gift_freeze_balance", cur_gift)
        .execute()
    )
    if not deduct_res.data:
        raise HTTPException(status_code=409, detail={"code": "RACE"})

    # Bump player's streak_freeze_balance (optimistic, 1 retry)
    stats_res = await (
        db.table("player_stats")
        .select("streak_freeze_balance")
        .eq("player_id", target_player_id)
        .maybe_single()
        .execute()
    )
    if not stats_res or not stats_res.data:
        # Rollback gift balance
        await (
            db.table("users")
            .update({"gift_freeze_balance": cur_gift})
            .eq("id", me_id)
            .execute()
        )
        raise HTTPException(status_code=404, detail="Player stats not found")

    cur_player_freeze = int(stats_res.data.get("streak_freeze_balance") or 0)
    new_player_freeze = cur_player_freeze + body.freeze_count

    bumped = False
    for _ in range(2):
        upd_res = await (
            db.table("player_stats")
            .update({"streak_freeze_balance": new_player_freeze})
            .eq("player_id", target_player_id)
            .eq("streak_freeze_balance", cur_player_freeze)
            .execute()
        )
        if upd_res.data:
            bumped = True
            break
        fresh_res = await (
            db.table("player_stats")
            .select("streak_freeze_balance")
            .eq("player_id", target_player_id)
            .single()
            .execute()
        )
        cur_player_freeze = int(fresh_res.data.get("streak_freeze_balance") or 0)
        new_player_freeze = cur_player_freeze + body.freeze_count

    if not bumped:
        await (
            db.table("users")
            .update({"gift_freeze_balance": cur_gift})
            .eq("id", me_id)
            .execute()
        )
        raise HTTPException(status_code=409, detail={"code": "RACE"})

    await emit_notification(
        db,
        user_id=target_player_id,
        type="freeze_gift",
        title="🎁 Подарок от Ответственного",
        message=body.message or "",
        payload={"freeze_count": body.freeze_count, "from_user_id": me_id},
    )

    return GiftFreezeResp(
        gifted=body.freeze_count,
        new_gift_freeze_balance=new_gift,
        new_player_streak_freeze_balance=new_player_freeze,
    )

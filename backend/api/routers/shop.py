"""Shop API — MarketCube (subscription v2)."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.deps import get_current_user
from ...db.client import get_supabase
from ...services.notifications import emit_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shop", tags=["shop"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ShopItem(BaseModel):
    id: str
    name: str
    description: str | None = ""
    category: str | None = None
    price_stars: int
    emoji: str | None = ""
    is_active: bool
    item_type: str = "generic"
    freeze_count: int = 0
    responsible_id: str | None = None
    player_id: str | None = None


class PurchaseRequest(BaseModel):
    item_id: str


class PurchaseResponse(BaseModel):
    success: bool
    new_balance: int
    message: str


class CreateShopItemReq(BaseModel):
    item_type: Literal['streak_freeze']
    freeze_count: int = Field(ge=1, le=50)
    price_stars: int = Field(ge=1, le=100000)
    name: str = Field(min_length=1, max_length=64)
    emoji: str | None = None
    player_id: uuid.UUID


class CreateShopItemResp(BaseModel):
    item: ShopItem
    new_shop_freeze_balance: int


class DeleteShopItemResp(BaseModel):
    deleted: bool
    refunded: int
    new_shop_freeze_balance: int


class GiftFreezeReq(BaseModel):
    player_id: uuid.UUID
    freeze_count: int = Field(ge=1, le=50)
    message: str = Field(max_length=500, default="")


class GiftFreezeResp(BaseModel):
    gifted: int
    new_gift_freeze_balance: int
    new_player_streak_freeze_balance: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _map_shop_item(row: dict) -> ShopItem:
    return ShopItem(
        id=str(row["id"]),
        name=row.get("name") or "",
        description=row.get("description") or "",
        category=row.get("category"),
        price_stars=int(row.get("price_stars") or 0),
        emoji=row.get("emoji") or "",
        is_active=bool(row.get("is_active", True)),
        item_type=row.get("item_type") or "generic",
        freeze_count=int(row.get("freeze_count") or 0),
        responsible_id=row.get("responsible_id"),
        player_id=row.get("player_id"),
    )


# ---------------------------------------------------------------------------
# GET /shop/items
# ---------------------------------------------------------------------------

@router.get("/items", response_model=list[ShopItem])
async def get_shop_items(
    player_id: uuid.UUID | None = None,
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()
    role = user.get("role", "")
    me_id = await _fetch_user_id(db, user["telegram_id"])

    if role == "player":
        target_player_id: str | None = me_id
    elif role in ("responsible", "admin"):
        if player_id is None:
            raise HTTPException(
                status_code=422,
                detail={"code": "PLAYER_ID_REQUIRED"},
            )
        target_player_id = str(player_id)
        ownership = await (
            db.table("partnerships")
            .select("player_id")
            .eq("responsible_id", me_id)
            .eq("player_id", target_player_id)
            .limit(1)
            .execute()
        )
        if not (ownership.data or []):
            raise HTTPException(
                status_code=403,
                detail={"code": "NOT_YOUR_PLAYER"},
            )
    else:
        raise HTTPException(status_code=403, detail="Forbidden")

    # Native lots (no responsible_id)
    native_res = await (
        db.table("shop_items")
        .select("*")
        .eq("is_active", True)
        .is_("responsible_id", "null")
        .execute()
    )
    native_rows = native_res.data or []

    # Targeted lots from the Player's Responsible
    targeted_rows: list[dict] = []
    if target_player_id:
        now_iso = datetime.now(timezone.utc).isoformat()
        pair_res = await (
            db.table("partnerships")
            .select("responsible_id")
            .eq("player_id", target_player_id)
            .gt("expires_at", now_iso)
            .limit(1)
            .execute()
        )
        pair_rows = pair_res.data or []
        if pair_rows:
            resp_id = pair_rows[0]["responsible_id"]
            tgt_res = await (
                db.table("shop_items")
                .select("*")
                .eq("is_active", True)
                .eq("responsible_id", resp_id)
                .eq("player_id", target_player_id)
                .execute()
            )
            targeted_rows = tgt_res.data or []

    merged = native_rows + targeted_rows
    merged.sort(key=lambda r: int(r.get("price_stars") or 0))
    return [_map_shop_item(r) for r in merged]


# ---------------------------------------------------------------------------
# POST /shop/items   (Responsible creates targeted lot for own Player)
# ---------------------------------------------------------------------------

@router.post("/items", response_model=CreateShopItemResp)
async def create_shop_item(
    body: CreateShopItemReq,
    user: dict = Depends(get_current_user),
):
    role = user.get("role", "")
    if role not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")

    db = await get_supabase()
    me_id = await _fetch_user_id(db, user["telegram_id"])
    target_player_id = str(body.player_id)

    now_iso = datetime.now(timezone.utc).isoformat()
    pair_res = await (
        db.table("partnerships")
        .select("id")
        .eq("responsible_id", me_id)
        .eq("player_id", target_player_id)
        .gt("expires_at", now_iso)
        .limit(1)
        .execute()
    )
    if not pair_res.data:
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_PLAYER"})

    bal_res = await (
        db.table("users")
        .select("shop_freeze_balance")
        .eq("id", me_id)
        .single()
        .execute()
    )
    current = int(bal_res.data.get("shop_freeze_balance") or 0)
    if current < body.freeze_count:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INSUFFICIENT_SHOP_FREEZE",
                "have": current,
                "need": body.freeze_count,
            },
        )

    new_balance = current - body.freeze_count
    deduct_res = await (
        db.table("users")
        .update({"shop_freeze_balance": new_balance})
        .eq("id", me_id)
        .eq("shop_freeze_balance", current)
        .execute()
    )
    if not deduct_res.data:
        raise HTTPException(status_code=409, detail={"code": "RACE"})

    ins_res = await (
        db.table("shop_items")
        .insert({
            "name": body.name,
            "emoji": body.emoji or "",
            "description": "",
            "category": None,
            "price_stars": body.price_stars,
            "item_type": body.item_type,
            "freeze_count": body.freeze_count,
            "responsible_id": me_id,
            "player_id": target_player_id,
            "is_active": True,
        })
        .execute()
    )
    if not ins_res.data:
        # Rollback deduct on insert failure
        await (
            db.table("users")
            .update({"shop_freeze_balance": current})
            .eq("id", me_id)
            .execute()
        )
        raise HTTPException(status_code=500, detail="Failed to create shop item")

    row = ins_res.data[0]
    return CreateShopItemResp(
        item=_map_shop_item(row),
        new_shop_freeze_balance=new_balance,
    )


# ---------------------------------------------------------------------------
# DELETE /shop/items/{item_id}
# ---------------------------------------------------------------------------

@router.delete("/items/{item_id}", response_model=DeleteShopItemResp)
async def delete_shop_item(
    item_id: uuid.UUID,
    user: dict = Depends(get_current_user),
):
    role = user.get("role", "")
    if role not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")

    db = await get_supabase()
    me_id = await _fetch_user_id(db, user["telegram_id"])
    item_id_str = str(item_id)

    item_res = await (
        db.table("shop_items")
        .select("id, responsible_id, freeze_count")
        .eq("id", item_id_str)
        .maybe_single()
        .execute()
    )
    if not item_res or not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")
    item = item_res.data
    if item.get("responsible_id") != me_id:
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_ITEM"})

    freeze_count = int(item.get("freeze_count") or 0)

    bal_res = await (
        db.table("users")
        .select("shop_freeze_balance")
        .eq("id", me_id)
        .single()
        .execute()
    )
    current = int(bal_res.data.get("shop_freeze_balance") or 0)

    del_res = await (
        db.table("shop_items")
        .delete()
        .eq("id", item_id_str)
        .eq("responsible_id", me_id)
        .execute()
    )
    if not del_res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    # Optimistic refund with 1 retry
    for _ in range(2):
        upd_res = await (
            db.table("users")
            .update({"shop_freeze_balance": current + freeze_count})
            .eq("id", me_id)
            .eq("shop_freeze_balance", current)
            .execute()
        )
        if upd_res.data:
            return DeleteShopItemResp(
                deleted=True,
                refunded=freeze_count,
                new_shop_freeze_balance=current + freeze_count,
            )
        fresh_res = await (
            db.table("users")
            .select("shop_freeze_balance")
            .eq("id", me_id)
            .single()
            .execute()
        )
        current = int(fresh_res.data.get("shop_freeze_balance") or 0)

    raise HTTPException(status_code=409, detail={"code": "RACE"})


# ---------------------------------------------------------------------------
# POST /shop/purchase
# ---------------------------------------------------------------------------

@router.post("/purchase", response_model=PurchaseResponse)
async def purchase_item(
    body: PurchaseRequest,
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()
    user_id = await _fetch_user_id(db, user["telegram_id"])

    item_res = await (
        db.table("shop_items")
        .select("*")
        .eq("id", body.item_id)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    if not item_res or not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    item = item_res.data

    if item.get("player_id") and str(item["player_id"]) != str(user_id):
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_ITEM"})

    price = int(item["price_stars"])
    item_type = item.get("item_type") or "generic"
    freeze_count = int(item.get("freeze_count") or 0)

    stats_res = await (
        db.table("player_stats")
        .select("star_balance, streak_freeze_balance")
        .eq("player_id", user_id)
        .maybe_single()
        .execute()
    )
    if not stats_res or not stats_res.data:
        raise HTTPException(status_code=404, detail="Player stats not found")

    balance = int(stats_res.data["star_balance"])
    if balance < price:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно звёзд: {balance}/{price}",
        )

    new_balance = balance - price
    deduct_res = await (
        db.table("player_stats")
        .update({"star_balance": new_balance})
        .eq("player_id", user_id)
        .eq("star_balance", balance)
        .execute()
    )
    if not deduct_res.data:
        raise HTTPException(
            status_code=409,
            detail="Баланс изменился, попробуйте снова.",
        )

    message = f"Куплено: {item['name']}"

    if item_type == "streak_freeze":
        cur_freeze = int(stats_res.data.get("streak_freeze_balance") or 0)
        new_freeze = cur_freeze + freeze_count
        bumped = False
        for _ in range(2):
            upd_res = await (
                db.table("player_stats")
                .update({"streak_freeze_balance": new_freeze})
                .eq("player_id", user_id)
                .eq("streak_freeze_balance", cur_freeze)
                .execute()
            )
            if upd_res.data:
                bumped = True
                break
            fresh_res = await (
                db.table("player_stats")
                .select("streak_freeze_balance")
                .eq("player_id", user_id)
                .single()
                .execute()
            )
            cur_freeze = int(fresh_res.data.get("streak_freeze_balance") or 0)
            new_freeze = cur_freeze + freeze_count

        if not bumped:
            # Rollback star_balance (optimistic, max 3 attempts)
            rolled_back = False
            cur_bal = new_balance
            target_bal = balance
            for _ in range(3):
                rb_res = await (
                    db.table("player_stats")
                    .update({"star_balance": target_bal})
                    .eq("player_id", user_id)
                    .eq("star_balance", cur_bal)
                    .execute()
                )
                if rb_res.data:
                    rolled_back = True
                    break
                fresh_bal_res = await (
                    db.table("player_stats")
                    .select("star_balance")
                    .eq("player_id", user_id)
                    .single()
                    .execute()
                )
                cur_bal = int(fresh_bal_res.data.get("star_balance") or 0)
                target_bal = cur_bal + price
            if not rolled_back:
                logger.critical(
                    "freeze purchase rollback FAILED user=%s amount=%s",
                    user_id,
                    price,
                )
            raise HTTPException(status_code=409, detail={"code": "RACE"})

        await (
            db.table("purchases")
            .insert({
                "player_id": user_id,
                "item_id": str(item["id"]),
                "price_paid": price,
            })
            .execute()
        )
        await (
            db.table("shop_items")
            .delete()
            .eq("id", item["id"])
            .execute()
        )
        message = f"+{freeze_count} заморозок"

    else:
        await (
            db.table("purchases")
            .insert({
                "player_id": user_id,
                "item_id": str(item["id"]),
                "price_paid": price,
            })
            .execute()
        )

    return PurchaseResponse(
        success=True,
        new_balance=new_balance,
        message=message,
    )


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

    now_iso = datetime.now(timezone.utc).isoformat()
    pair_res = await (
        db.table("partnerships")
        .select("id")
        .eq("responsible_id", me_id)
        .eq("player_id", target_player_id)
        .gt("expires_at", now_iso)
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

"""Shop API — MarketCube."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/shop", tags=["shop"])


class ShopItem(BaseModel):
    id: str
    name: str
    description: str
    category: str
    price_stars: int
    emoji: str
    is_active: bool


class PurchaseRequest(BaseModel):
    item_id: str


class PurchaseResponse(BaseModel):
    success: bool
    new_balance: int
    message: str


@router.get("/items", response_model=list[ShopItem])
async def get_shop_items(user: dict = Depends(get_current_user)):
    db = await get_supabase()

    result = (
        await db.table("shop_items")
        .select("*")
        .eq("is_active", True)
        .order("price_stars")
        .execute()
    )

    return [ShopItem(**item) for item in (result.data or [])]


@router.post("/purchase", response_model=PurchaseResponse)
async def purchase_item(
    body: PurchaseRequest,
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()

    # Получить user_id
    user_res = (
        await db.table("users")
        .select("id")
        .eq("telegram_id", user["telegram_id"])
        .single()
        .execute()
    )
    user_id = user_res.data["id"]

    # Получить товар
    item_res = (
        await db.table("shop_items")
        .select("*")
        .eq("id", body.item_id)
        .eq("is_active", True)
        .single()
        .execute()
    )
    if not item_res.data:
        raise HTTPException(status_code=404, detail="Item not found")

    item = item_res.data
    price = item["price_stars"]

    # Получить баланс
    stats_res = (
        await db.table("player_stats")
        .select("star_balance")
        .eq("player_id", user_id)
        .single()
        .execute()
    )
    if not stats_res.data:
        raise HTTPException(status_code=404, detail="Player stats not found")

    balance = stats_res.data["star_balance"]

    if balance < price:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно звёзд: {balance}/{price}",
        )

    new_balance = balance - price

    # Списать звёзды
    await (
        db.table("player_stats")
        .update({"star_balance": new_balance})
        .eq("player_id", user_id)
        .execute()
    )

    # Записать покупку
    await (
        db.table("purchases")
        .insert({
            "player_id": user_id,
            "item_id": body.item_id,
            "price_paid": price,
        })
        .execute()
    )

    return PurchaseResponse(
        success=True,
        new_balance=new_balance,
        message=f"Куплено: {item['name']}",
    )

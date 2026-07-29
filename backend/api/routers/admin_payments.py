"""Admin payment management (task 7.4). All endpoints require_admin.

  GET   /admin/payments               — ledger, newest first, with buyer + product.
  POST  /admin/payments/{id}/refund   — refund Stars + notify buyer.
  GET   /admin/star-products          — product catalogue with prices.
  PATCH /admin/star-products/{type}   — edit price / is_active.
  GET   /admin/stars-balance          — bot's current Stars balance.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ...core.deps import get_bot, require_admin
from ...db.client import get_supabase
from ...services.bot_notify import send_bot_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin-payments"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PaymentRow(BaseModel):
    id: str
    buyer_name: str | None = None
    buyer_telegram_id: int | None = None
    product_type: str
    product_title: str | None = None
    amount_stars: int
    status: str
    created_at: str | None = None
    tier: str | None = None
    period: str | None = None
    discount_pct: int | None = None
    coupon_code: str | None = None


class RefundResponse(BaseModel):
    refunded: bool


class StarProduct(BaseModel):
    product_type: str
    title: str
    description: str
    price_stars: int
    is_active: bool
    updated_at: str | None = None


class UpdateProductReq(BaseModel):
    price_stars: int | None = Field(default=None, ge=1)
    is_active: bool | None = None


class StarsBalanceResponse(BaseModel):
    amount: int
    nanostar_amount: int = 0


# ---------------------------------------------------------------------------
# GET /admin/payments
# ---------------------------------------------------------------------------

@router.get("/payments", response_model=list[PaymentRow])
async def list_payments(
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    admin: dict = Depends(require_admin),
):
    db = await get_supabase()
    q = db.table("payments").select(
        "id, buyer_user_id, product_type, amount_stars, status, created_at, "
        "tier, period, discount_pct, coupon_id"
    )
    if status:
        q = q.eq("status", status)
    res = await q.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    rows = res.data or []

    buyer_ids = list({r["buyer_user_id"] for r in rows if r.get("buyer_user_id")})
    product_types = list({r["product_type"] for r in rows if r.get("product_type")})
    coupon_ids = list({r["coupon_id"] for r in rows if r.get("coupon_id")})

    buyers: dict = {}
    if buyer_ids:
        bres = await (
            db.table("users")
            .select("id, first_name, telegram_id")
            .in_("id", buyer_ids)
            .execute()
        )
        buyers = {str(b["id"]): b for b in (bres.data or [])}

    titles: dict = {}
    if product_types:
        pres = await (
            db.table("star_products")
            .select("product_type, title")
            .in_("product_type", product_types)
            .execute()
        )
        titles = {p["product_type"]: p["title"] for p in (pres.data or [])}

    coupon_codes: dict = {}
    if coupon_ids:
        cres = await db.table("coupons").select("id, code").in_("id", coupon_ids).execute()
        coupon_codes = {str(c["id"]): c["code"] for c in (cres.data or [])}

    out = []
    for r in rows:
        b = buyers.get(str(r.get("buyer_user_id")), {})
        out.append(PaymentRow(
            id=str(r["id"]),
            buyer_name=b.get("first_name"),
            buyer_telegram_id=b.get("telegram_id"),
            product_type=r["product_type"],
            product_title=titles.get(r["product_type"]),
            amount_stars=int(r["amount_stars"]),
            status=r["status"],
            created_at=r.get("created_at"),
            tier=r.get("tier"),
            period=r.get("period"),
            discount_pct=r.get("discount_pct"),
            coupon_code=coupon_codes.get(str(r.get("coupon_id"))) if r.get("coupon_id") else None,
        ))
    return out


# ---------------------------------------------------------------------------
# POST /admin/payments/{payment_id}/refund
# ---------------------------------------------------------------------------

@router.post("/payments/{payment_id}/refund", response_model=RefundResponse)
async def refund_payment(
    payment_id: str,
    admin: dict = Depends(require_admin),
):
    db = await get_supabase()

    res = await (
        db.table("payments")
        .select("id, status, product_type, target_partnership_id, "
                "telegram_payment_charge_id, buyer_user_id")
        .eq("id", payment_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="Payment not found")
    p = res.data

    if p["status"] not in ("paid", "fulfilled"):
        raise HTTPException(status_code=400, detail={"code": "NOT_REFUNDABLE", "status": p["status"]})
    if not p.get("telegram_payment_charge_id"):
        raise HTTPException(status_code=400, detail={"code": "NO_CHARGE_ID"})

    # Buyer telegram_id (needed by Telegram refund API + notification).
    buyer_res = await (
        db.table("users")
        .select("telegram_id")
        .eq("id", p["buyer_user_id"])
        .maybe_single()
        .execute()
    )
    if not buyer_res or not buyer_res.data:
        raise HTTPException(status_code=404, detail="Buyer not found")
    buyer_tg = int(buyer_res.data["telegram_id"])

    bot = get_bot()
    try:
        await bot.refund_star_payment(
            user_id=buyer_tg,
            telegram_payment_charge_id=p["telegram_payment_charge_id"],
        )
    except Exception as e:
        logger.error("refund_star_payment failed payment=%s: %s", payment_id, e)
        raise HTTPException(status_code=502, detail={"code": "REFUND_FAILED"})

    await (
        db.table("payments")
        .update({"status": "refunded", "refunded_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", payment_id)
        .execute()
    )

    # 8d: автоматической отмены товара при возврате нет. Купленный лот полки
    # и зачисленные капли админ правит вручную (споры — §8.8a п.7).
    await send_bot_message(
        bot,
        buyer_tg,
        "↩️ Возврат оформлен: звёзды возвращены на ваш баланс Telegram.",
    )

    return RefundResponse(refunded=True)


# ---------------------------------------------------------------------------
# GET /admin/star-products  +  PATCH /admin/star-products/{product_type}
# ---------------------------------------------------------------------------

@router.get("/star-products", response_model=list[StarProduct])
async def list_star_products(admin: dict = Depends(require_admin)):
    db = await get_supabase()
    res = await (
        db.table("star_products")
        .select("product_type, title, description, price_stars, is_active, updated_at")
        .order("price_stars")
        .execute()
    )
    return [StarProduct(**row) for row in (res.data or [])]


@router.patch("/star-products/{product_type}", response_model=StarProduct)
async def update_star_product(
    product_type: str,
    body: UpdateProductReq,
    admin: dict = Depends(require_admin),
):
    db = await get_supabase()
    update: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.price_stars is not None:
        update["price_stars"] = body.price_stars
    if body.is_active is not None:
        update["is_active"] = body.is_active
    if len(update) == 1:
        raise HTTPException(status_code=400, detail="Nothing to update")

    res = await (
        db.table("star_products")
        .update(update)
        .eq("product_type", product_type)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Product not found")
    return StarProduct(**res.data[0])


# ---------------------------------------------------------------------------
# GET /admin/stars-balance
# ---------------------------------------------------------------------------

@router.get("/stars-balance", response_model=StarsBalanceResponse)
async def stars_balance(admin: dict = Depends(require_admin)):
    bot = get_bot()
    try:
        bal = await bot.get_my_star_balance()
    except Exception as e:
        logger.error("get_my_star_balance failed: %s", e)
        raise HTTPException(status_code=502, detail={"code": "BALANCE_FAILED"})
    return StarsBalanceResponse(
        amount=getattr(bal, "amount", 0),
        nanostar_amount=getattr(bal, "nanostar_amount", 0) or 0,
    )

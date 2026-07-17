"""Payments API — Telegram Stars invoices (task 7.4).

Flow:
  POST /payments/invoice   → Responsible buys a product for own Player; creates a
                             `pending` payment row + a Telegram invoice link.
  GET  /payments/{id}      → buyer polls own payment status.
  GET  /payments/products  → active products + live prices (for the buy UI).

Prices come ONLY from the star_products table. amount_stars is snapshotted onto the
payment row at invoice time so an admin price change can never alter an open invoice.
"""
import logging
from datetime import datetime, timezone
from typing import Literal

from aiogram.types import LabeledPrice
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...core.deps import get_bot, get_current_user
from ...db.client import get_supabase
from ...services.tier_pricing import (
    apply_coupon,
    base_price,
    get_tier_price_row,
    insert_tier_payment,
    invoice_description,
    invoice_title,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class InvoiceRequest(BaseModel):
    product_type: str
    player_id: str


class InvoiceResponse(BaseModel):
    payment_id: str
    invoice_link: str


class PaymentStatusResponse(BaseModel):
    status: str


class ProductInfo(BaseModel):
    product_type: str
    title: str
    description: str
    price_stars: int


class TierPriceInfo(BaseModel):
    tier: str
    intro_price_stars: int
    price_1m: int
    price_3m: int
    price_12m: int


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


# ---------------------------------------------------------------------------
# GET /payments/products
# ---------------------------------------------------------------------------

@router.get("/products", response_model=list[ProductInfo])
async def list_products(user: dict = Depends(get_current_user)):
    db = await get_supabase()
    res = await (
        db.table("star_products")
        .select("product_type, title, description, price_stars")
        .eq("is_active", True)
        .order("price_stars")
        .execute()
    )
    return [ProductInfo(**row) for row in (res.data or [])]


@router.get("/tier-prices", response_model=list[TierPriceInfo])
async def list_tier_prices_public(user: dict = Depends(get_current_user)):
    """Витрина тарифов (пейволл/продление) — read-only prices from tier_prices."""
    db = await get_supabase()
    res = await (
        db.table("tier_prices")
        .select("tier, intro_price_stars, price_1m, price_3m, price_12m")
        .execute()
    )
    order = {"standard": 0, "premium": 1, "elite": 2}
    rows = sorted(res.data or [], key=lambda r: order.get(r["tier"], 9))
    return [TierPriceInfo(**r) for r in rows]


# ---------------------------------------------------------------------------
# POST /payments/invoice
# ---------------------------------------------------------------------------

@router.post("/invoice", response_model=InvoiceResponse)
async def create_invoice(
    body: InvoiceRequest,
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()
    buyer_id = await _fetch_user_id(db, user["telegram_id"])

    # Authorization: caller must be the Responsible of an ACTIVE partnership with player_id.
    # (Partnerships are indefinite in 7.5 — liveness is status='active', not expires_at.)
    part_res = await (
        db.table("partnerships")
        .select("id")
        .eq("responsible_id", buyer_id)
        .eq("player_id", body.player_id)
        .eq("status", "active")
        .maybe_single()
        .execute()
    )
    if not part_res or not part_res.data:
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_PLAYER"})
    partnership_id = part_res.data["id"]

    # Product + price come ONLY from the DB.
    prod_res = await (
        db.table("star_products")
        .select("product_type, title, description, price_stars, is_active")
        .eq("product_type", body.product_type)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    if not prod_res or not prod_res.data:
        raise HTTPException(status_code=400, detail={"code": "PRODUCT_UNAVAILABLE"})
    product = prod_res.data
    price_stars = int(product["price_stars"])

    # Insert pending payment (snapshot price) → get id for the invoice payload.
    ins_res = await (
        db.table("payments")
        .insert({
            "buyer_user_id": buyer_id,
            "product_type": body.product_type,
            "target_partnership_id": partnership_id,
            "amount_stars": price_stars,
            "status": "pending",
        })
        .execute()
    )
    if not ins_res.data:
        raise HTTPException(status_code=500, detail="Failed to create payment")
    payment_id = str(ins_res.data[0]["id"])

    # Create the Telegram Stars invoice link. provider_token is OMITTED for XTR.
    bot = get_bot()
    try:
        invoice_link = await bot.create_invoice_link(
            title=product["title"],
            description=product["description"],
            payload=payment_id,
            currency="XTR",
            prices=[LabeledPrice(label=product["title"], amount=price_stars)],
        )
    except Exception as e:
        logger.error("create_invoice_link failed payment=%s: %s", payment_id, e)
        await (
            db.table("payments")
            .update({"status": "failed"})
            .eq("id", payment_id)
            .eq("status", "pending")
            .execute()
        )
        raise HTTPException(status_code=502, detail={"code": "INVOICE_FAILED"})

    await (
        db.table("payments")
        .update({"invoice_link": invoice_link})
        .eq("id", payment_id)
        .execute()
    )

    return InvoiceResponse(payment_id=payment_id, invoice_link=invoice_link)


# ---------------------------------------------------------------------------
# GET /payments/{payment_id}
# ---------------------------------------------------------------------------

@router.get("/{payment_id}", response_model=PaymentStatusResponse)
async def get_payment(
    payment_id: str,
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()
    buyer_id = await _fetch_user_id(db, user["telegram_id"])

    res = await (
        db.table("payments")
        .select("status, buyer_user_id")
        .eq("id", payment_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data or str(res.data["buyer_user_id"]) != str(buyer_id):
        raise HTTPException(status_code=404, detail="Payment not found")

    return PaymentStatusResponse(status=res.data["status"])


# ---------------------------------------------------------------------------
# POST /payments/tier-invoice  — subscription (tier) payments + coupons (7.5)
# ---------------------------------------------------------------------------

class TierInvoiceRequest(BaseModel):
    tier: Literal["standard", "premium", "elite"]
    period: Literal["intro", "1m", "3m", "12m"]
    coupon_code: str | None = None


async def _has_fulfilled_tier_payment(db, buyer_id: str) -> bool:
    res = await (
        db.table("payments").select("id")
        .eq("buyer_user_id", buyer_id).like("product_type", "tier_%")
        .eq("status", "fulfilled").limit(1).execute()
    )
    return bool(res.data)


async def _validate_coupon(db, code: str) -> dict:
    res = await db.table("coupons").select("*").eq("code", code.strip()).maybe_single().execute()
    c = res.data if res else None
    if not c or not c.get("is_active"):
        raise HTTPException(status_code=400, detail={"code": "COUPON_INVALID"})
    exp = c.get("expires_at")
    if exp:
        try:
            dt = datetime.fromisoformat(exp)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt <= datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail={"code": "COUPON_EXPIRED"})
        except (ValueError, TypeError):
            pass
    max_uses = c.get("max_uses")
    if max_uses is not None and int(c.get("used_count") or 0) >= int(max_uses):
        raise HTTPException(status_code=400, detail={"code": "COUPON_EXHAUSTED"})
    return c


@router.post("/tier-invoice", response_model=InvoiceResponse)
async def create_tier_invoice(
    body: TierInvoiceRequest,
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()
    buyer_res = await (
        db.table("users")
        .select("id, pricing_mode, custom_price_stars")
        .eq("telegram_id", user["telegram_id"])
        .maybe_single()
        .execute()
    )
    if not buyer_res or not buyer_res.data:
        raise HTTPException(status_code=404, detail="User not found")
    buyer = buyer_res.data
    buyer_id = buyer["id"]
    pricing_mode = buyer.get("pricing_mode")
    tier, period = body.tier, body.period
    coupon_id: str | None = None
    discount_pct: int | None = None

    # All price validation is server-side only.
    if pricing_mode == "free":
        raise HTTPException(status_code=400, detail={"code": "FREE_NO_INVOICE"})

    if pricing_mode == "custom":
        if period != "1m":
            raise HTTPException(status_code=400, detail={"code": "CUSTOM_PERIOD_1M_ONLY"})
        if body.coupon_code:
            raise HTTPException(status_code=400, detail={"code": "CUSTOM_NO_COUPON"})
        amount = int(buyer.get("custom_price_stars") or 0)
        if amount < 1:
            raise HTTPException(status_code=400, detail={"code": "CUSTOM_PRICE_UNSET"})
    else:
        price_row = await get_tier_price_row(db, tier)
        if not price_row:
            raise HTTPException(status_code=400, detail={"code": "TIER_UNAVAILABLE"})
        is_first = not await _has_fulfilled_tier_payment(db, buyer_id)
        if is_first:
            # First payment: intro month only, no coupon.
            if period != "intro":
                raise HTTPException(status_code=400, detail={"code": "FIRST_PAYMENT_INTRO_ONLY"})
            if body.coupon_code:
                raise HTTPException(status_code=400, detail={"code": "INTRO_NO_COUPON"})
            amount = base_price(price_row, "intro")
        else:
            if period not in ("1m", "3m", "12m"):
                raise HTTPException(status_code=400, detail={"code": "RENEWAL_PERIOD_INVALID"})
            amount = base_price(price_row, period)
            if body.coupon_code:
                coupon = await _validate_coupon(db, body.coupon_code)
                coupon_id = str(coupon["id"])
                discount_pct = int(coupon["discount_pct"])
                amount = apply_coupon(amount, discount_pct)
        if not amount or amount < 1:
            raise HTTPException(status_code=400, detail={"code": "PRICE_UNSET"})

    payment_id = await insert_tier_payment(db, buyer_id, tier, period, amount, coupon_id, discount_pct)

    bot = get_bot()
    title = invoice_title(tier, period)
    try:
        invoice_link = await bot.create_invoice_link(
            title=title,
            description=invoice_description(tier, period),
            payload=payment_id,
            currency="XTR",
            prices=[LabeledPrice(label=title, amount=amount)],
        )
    except Exception as e:
        logger.error("create_invoice_link (tier) failed payment=%s: %s", payment_id, e)
        await (
            db.table("payments").update({"status": "failed"})
            .eq("id", payment_id).eq("status", "pending").execute()
        )
        raise HTTPException(status_code=502, detail={"code": "INVOICE_FAILED"})

    await db.table("payments").update({"invoice_link": invoice_link}).eq("id", payment_id).execute()
    return InvoiceResponse(payment_id=payment_id, invoice_link=invoice_link)

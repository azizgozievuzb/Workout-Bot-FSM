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

from aiogram.types import LabeledPrice
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...core.deps import get_bot, get_current_user
from ...db.client import get_supabase

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
    now_iso = datetime.now(timezone.utc).isoformat()
    part_res = await (
        db.table("partnerships")
        .select("id")
        .eq("responsible_id", buyer_id)
        .eq("player_id", body.player_id)
        .eq("status", "active")
        .gt("expires_at", now_iso)
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

"""Payments API — Telegram Stars invoices (task 7.4).

Flow:
  POST /payments/tier-invoice       → subscription (tier) payment + coupons (7.5).
  POST /payments/drop-pack-invoice  → Responsible buys a drops pack into own
                                      gift_balance (8d, §8.7). Партнёрства не требует.
  GET  /payments/drop-packs         → active packs + live prices (buy UI).
  GET  /payments/{id}               → buyer polls own payment status.
  GET  /payments/products           → active products + live prices (for the buy UI).

Shelf star-item invoices live in routers/shelf.py (they need slot/limit checks) and
reuse `create_stars_invoice` from here.

Prices come ONLY from the DB (tier_prices / drop_packs / shelf_catalog).
amount_stars is snapshotted onto the payment row at invoice time so an admin price
change can never alter an open invoice; fulfilment context lives in payments.meta.
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
    TIER_PLAYER_LIMITS,
    apply_coupon,
    base_price,
    get_tier_price_row,
    insert_tier_payment,
    invoice_description,
    invoice_title,
)
from ...services.invites import count_active_partnerships

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class InvoiceResponse(BaseModel):
    payment_id: str
    invoice_link: str


class PaymentStatusResponse(BaseModel):
    status: str


class TierPriceInfo(BaseModel):
    tier: str
    intro_price_stars: int
    price_1m: int
    price_3m: int
    price_12m: int


class DropPackInfo(BaseModel):
    key: str
    drops: int
    price_stars: int


class DropPackInvoiceRequest(BaseModel):
    pack_key: str


class OkResponse(BaseModel):
    ok: bool = True


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


async def create_stars_invoice(
    db,
    *,
    buyer_id: str,
    product_type: str,
    title: str,
    description: str,
    price_stars: int,
    partnership_id: str | None = None,
    meta: dict | None = None,
) -> tuple[str, str]:
    """Общая механика счёта Stars (7.4): pending-платёж со снапшотом цены →
    create_invoice_link. `meta` несёт контекст исполнения (8d): пакет капель,
    ключ каталога полки, цена лота в каплях, игрок-получатель.

    Возвращает (payment_id, invoice_link). Бросает HTTPException при отказе Telegram.
    """
    row: dict = {
        "buyer_user_id": buyer_id,
        "product_type": product_type,
        "target_partnership_id": partnership_id,
        "amount_stars": price_stars,
        "status": "pending",
    }
    if meta:
        row["meta"] = meta

    ins_res = await db.table("payments").insert(row).execute()
    if not ins_res.data:
        raise HTTPException(status_code=500, detail="Failed to create payment")
    payment_id = str(ins_res.data[0]["id"])

    # Telegram: title ≤ 32, description ≤ 255. provider_token OMITTED for XTR.
    safe_title = title[:32]
    bot = get_bot()
    try:
        invoice_link = await bot.create_invoice_link(
            title=safe_title,
            description=description[:255],
            payload=payment_id,
            currency="XTR",
            prices=[LabeledPrice(label=safe_title, amount=price_stars)],
        )
    except Exception as e:
        logger.error("create_invoice_link failed payment=%s (%s): %s", payment_id, product_type, e)
        await (
            db.table("payments")
            .update({"status": "failed"})
            .eq("id", payment_id)
            .eq("status", "pending")
            .execute()
        )
        raise HTTPException(status_code=502, detail={"code": "INVOICE_FAILED"})

    await db.table("payments").update({"invoice_link": invoice_link}).eq("id", payment_id).execute()
    return payment_id, invoice_link


# ---------------------------------------------------------------------------
# Drop packs (8d) — пул капель Ответственного
# ---------------------------------------------------------------------------

@router.get("/drop-packs", response_model=list[DropPackInfo])
async def list_drop_packs(user: dict = Depends(get_current_user)):
    """Пакеты капель для пула дарения Ответственного (§8.7). Цены — из БД."""
    db = await get_supabase()
    res = await (
        db.table("drop_packs")
        .select("key, drops, price_stars")
        .eq("is_active", True)
        .order("drops")
        .execute()
    )
    return [DropPackInfo(**row) for row in (res.data or [])]


@router.post("/drop-pack-invoice", response_model=InvoiceResponse)
async def create_drop_pack_invoice(
    body: DropPackInvoiceRequest,
    user: dict = Depends(get_current_user),
):
    """Ответственный покупает пакет капель В СВОЙ пул дарения — партнёрство не
    требуется (капли лежат у R до дарения). Игрок капли за Stars купить не может
    (анти pay-to-win, §8.7) — эндпоинт закрыт ролью."""
    if user.get("role") not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail={"code": "RESPONSIBLE_ONLY"})

    db = await get_supabase()
    buyer_id = await _fetch_user_id(db, user["telegram_id"])

    pack_res = await (
        db.table("drop_packs")
        .select("key, drops, price_stars, is_active")
        .eq("key", body.pack_key)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    if not pack_res or not pack_res.data:
        raise HTTPException(status_code=400, detail={"code": "PACK_UNAVAILABLE"})
    pack = pack_res.data
    drops = int(pack["drops"])

    payment_id, invoice_link = await create_stars_invoice(
        db,
        buyer_id=buyer_id,
        product_type="drop_pack",
        title=f"{drops} 💧 для игрока",
        description=(
            f"Пакет из {drops} капель в ваш пул подарков. "
            "Капли дарятся игроку из панели наставника."
        ),
        price_stars=int(pack["price_stars"]),
        meta={"pack_key": pack["key"], "drops": drops},
    )
    return InvoiceResponse(payment_id=payment_id, invoice_link=invoice_link)


# ---------------------------------------------------------------------------
# POST /payments/renewal-invoice — «Продлить» из шапки Market R (Э.3.2)
# ---------------------------------------------------------------------------

@router.post("/renewal-invoice", response_model=OkResponse)
async def send_renewal_invoice_to_chat(user: dict = Depends(get_current_user)):
    """Бот присылает счёт продления ТЕКУЩЕГО тарифа в чат наставника.

    Это дом старого долга «чат-счёт продления»: платёжка та же, что у
    ежедневного напоминания (7.5), поэтому переиспользуем её функцию, а не
    пишем вторую. Счёт уходит в чат, не в мини-апп — оплата Stars живёт там.
    """
    if user.get("role") not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail={"code": "RESPONSIBLE_ONLY"})

    db = await get_supabase()
    res = await (
        db.table("users")
        .select("id, telegram_id, responsible_access_tier, subscription_expires_at, pricing_mode")
        .eq("telegram_id", user["telegram_id"])
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})
    row = res.data
    if row.get("pricing_mode") == "free":
        raise HTTPException(status_code=400, detail={"code": "FREE_NO_INVOICE"})

    # Импорт локальный: джоб тянет core.deps.get_bot внутри себя, а роутеру
    # незачем зависеть от планировщика на уровне модуля.
    from ...schedulers.subscription_lifecycle import _send_renewal_invoice

    expired = False
    exp = row.get("subscription_expires_at")
    if exp:
        dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        expired = dt <= datetime.now(timezone.utc)

    sent = await _send_renewal_invoice(db, get_bot(), row, expired=expired)
    if not sent:
        raise HTTPException(status_code=502, detail={"code": "INVOICE_FAILED"})
    return OkResponse()


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


async def _validate_coupon(db, code: str, buyer_id: str) -> dict:
    """Validate a coupon for a specific buyer. Checks identical for invoice + preview:
    active, not expired, max_uses not exhausted, once_per_user not already used."""
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
    if c.get("once_per_user"):
        used = await (
            db.table("payments").select("id")
            .eq("buyer_user_id", buyer_id).eq("coupon_id", str(c["id"]))
            .in_("status", ["paid", "fulfilled"]).limit(1).execute()
        )
        if used.data:
            raise HTTPException(status_code=400, detail={"code": "COUPON_ALREADY_USED"})
    return c


async def _assert_tier_fits_players(db, buyer_id: str, tier: str) -> None:
    """Downgrade gate: refuse a tier whose slot limit is below the buyer's active
    player count. Frontend catches 409 DOWNGRADE_BLOCKED → eviction modal → re-invoice."""
    limit = TIER_PLAYER_LIMITS.get(tier, 1)
    active = await count_active_partnerships(db, buyer_id)
    if limit < active:
        raise HTTPException(
            status_code=409,
            detail={"code": "DOWNGRADE_BLOCKED", "excess": active - limit},
        )


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

    # Downgrade gate — never issue an invoice for a tier that can't hold the
    # buyer's current active players (applies to custom + standard modes alike).
    await _assert_tier_fits_players(db, buyer_id, tier)

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
                coupon = await _validate_coupon(db, body.coupon_code, buyer_id)
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


# ---------------------------------------------------------------------------
# POST /payments/coupon-preview — live coupon recalculation for RenewalScreen
# ---------------------------------------------------------------------------

class CouponPreviewRequest(BaseModel):
    code: str
    tier: Literal["standard", "premium", "elite"]
    period: Literal["1m", "3m", "12m"]


class CouponPreviewResponse(BaseModel):
    valid: bool
    pct: int = 0
    final_price: int = 0
    base_price: int = 0
    code: str | None = None  # reason code when valid is false


@router.post("/coupon-preview", response_model=CouponPreviewResponse)
async def coupon_preview(
    body: CouponPreviewRequest,
    user: dict = Depends(get_current_user),
):
    """Validate a coupon against a tier/period and return the discounted total.
    Checks are identical to invoice creation (active, expires, max_uses, once_per_user)."""
    db = await get_supabase()
    buyer_id = await _fetch_user_id(db, user["telegram_id"])

    price_row = await get_tier_price_row(db, body.tier)
    base = base_price(price_row, body.period) if price_row else None
    if not base or base < 1:
        return CouponPreviewResponse(valid=False, code="PRICE_UNSET")

    try:
        coupon = await _validate_coupon(db, body.code, buyer_id)
    except HTTPException as e:
        reason = e.detail.get("code") if isinstance(e.detail, dict) else "COUPON_INVALID"
        return CouponPreviewResponse(valid=False, base_price=base, code=reason)

    pct = int(coupon["discount_pct"])
    final = apply_coupon(base, pct)
    return CouponPreviewResponse(valid=True, pct=pct, final_price=final, base_price=base)

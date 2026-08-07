"""Aiogram handlers for Telegram Stars payments (task 7.4 + 8d).

  * pre_checkout_query  — validate against the payment snapshot; MUST answer < 10s.
  * successful_payment  — idempotent mark-paid → fulfill → notify.
  * /paysupport, /terms — required commands for bots selling via Stars.

Product types: `tier_*` (subscription, 7.5), `drop_pack` (пул капель наставника),
`shelf_star_item` (предмет на полку игрока). Контекст исполнения — в payments.meta.
Бусты X2 выпилены в 8d; исторические платежи product_type='boost_*' не трогаем.

No automatic refunds: a fulfill failure leaves the payment 'paid' and asks the user
to contact support. Refunds are admin-only (admin_payments router).
"""
import logging
from datetime import datetime, timedelta, timezone

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import Message, PreCheckoutQuery

from ..db.client import get_supabase
from ..services.bot_notify import send_bot_message
from ..services.notifications import emit_notification
from ..services.tier_pricing import PERIOD_DAYS, PERIOD_LABELS, TIER_TITLES

logger = logging.getLogger(__name__)

payments_router = Router(name="payments")

SUPPORT_CONTACT = "@conectionWorkout_bot"

# Партнёрство-получатель обязательно только для лотов полки.
_NEEDS_PARTNERSHIP = ("shelf_star_item",)


def _is_tier(product_type: str | None) -> bool:
    return bool(product_type) and str(product_type).startswith("tier_")


def _parse_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


async def _partnership_active(db, partnership_id: str) -> bool:
    res = await (
        db.table("partnerships")
        .select("id")
        .eq("id", partnership_id)
        .eq("status", "active")
        .maybe_single()
        .execute()
    )
    return bool(res and res.data)


# ---------------------------------------------------------------------------
# Tier subscription fulfilment (7.5)
# ---------------------------------------------------------------------------

async def _fulfill_tier_payment(db, message: Message, payment: dict) -> None:
    """Idempotent (mark-paid already won). Extend/activate the Responsible's subscription."""
    payment_id = payment["id"]
    buyer_id = payment["buyer_user_id"]
    tier = payment.get("tier") or "standard"
    period = payment.get("period") or "1m"
    days = PERIOD_DAYS.get(period, 30)
    now = datetime.now(timezone.utc)

    u_res = await (
        db.table("users")
        .select("subscription_expires_at, has_player_access")
        .eq("id", buyer_id)
        .maybe_single()
        .execute()
    )
    u = (u_res.data if u_res else None) or {}
    cur = _parse_dt(u.get("subscription_expires_at"))
    base = cur if (cur and cur > now) else now
    new_exp = base + timedelta(days=days)

    update = {
        "subscription_expires_at": new_exp.isoformat(),
        "responsible_access_tier": tier,
        "has_responsible_access": True,
        "last_renewal_reminder_at": None,
    }
    # First-time Responsible (not a dual-role player) → set primary role + finish onboarding gate.
    if not u.get("has_player_access"):
        update["primary_role"] = "responsible"
        update["role"] = "responsible"
        update["onboarding_done"] = True
        update["onboarding_state"] = "onboardingComplete"

    try:
        await db.table("users").update(update).eq("id", buyer_id).execute()

        # Increment coupon usage (best-effort, optimistic).
        coupon_id = payment.get("coupon_id")
        if coupon_id:
            c_res = await db.table("coupons").select("used_count").eq("id", coupon_id).maybe_single().execute()
            cur_uc = int(c_res.data.get("used_count") or 0) if (c_res and c_res.data) else 0
            await (
                db.table("coupons").update({"used_count": cur_uc + 1})
                .eq("id", coupon_id).eq("used_count", cur_uc).execute()
            )

        await (
            db.table("payments")
            .update({"status": "fulfilled", "fulfilled_at": now.isoformat()})
            .eq("id", payment_id)
            .execute()
        )
    except Exception as e:
        logger.error("FULFILL TIER FAILED payment=%s: %s", payment_id, e)
        await message.answer(
            "✅ Оплата получена. Подписка активируется автоматически. "
            f"Если возникнут проблемы — напишите {SUPPORT_CONTACT} или отправьте /paysupport."
        )
        return

    tier_title = TIER_TITLES.get(tier, tier)
    period_label = PERIOD_LABELS.get(period, period)
    date_str = new_exp.strftime("%d.%m.%Y")
    await message.answer(
        f"✅ Подписка <b>{tier_title}</b> активна ({period_label}).\n"
        f"Доступ действует до <b>{date_str}</b>. Спасибо за поддержку!"
    )


# ---------------------------------------------------------------------------
# 8d fulfilment: drop pack → пул дарения; shelf star item → лот на полке игрока
# ---------------------------------------------------------------------------

async def _mark_fulfilled(db, payment_id: str) -> None:
    await (
        db.table("payments")
        .update({"status": "fulfilled", "fulfilled_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", payment_id)
        .execute()
    )


async def _fulfill_drop_pack(db, message: Message, payment: dict) -> None:
    """Капли пакета ложатся в gift_balance покупателя (§8.7). Идемпотентность —
    на уровне mark-paid: сюда попадает только первый обработчик платежа."""
    payment_id = payment["id"]
    meta = payment.get("meta") or {}
    drops = int(meta.get("drops") or 0)
    try:
        if drops < 1:
            raise ValueError(f"bad drop_pack meta: {meta}")
        res = await db.rpc("credit_gift_balance", {
            "p_user_id": payment["buyer_user_id"], "p_drops": drops,
        }).execute()
        data = res.data if isinstance(res.data, dict) else {}
        if not data.get("ok"):
            raise ValueError(f"credit_gift_balance failed: {data}")
        await _mark_fulfilled(db, payment_id)
    except Exception as e:
        logger.error("FULFILL DROP PACK FAILED payment=%s: %s", payment_id, e)
        await message.answer(
            "✅ Оплата получена. Капли будут зачислены. "
            f"Если баланс не изменится — напишите {SUPPORT_CONTACT} или отправьте /paysupport."
        )
        return

    await message.answer(
        f"💧 Зачислено <b>{drops}</b> капель в пул подарков.\n"
        "Подарить их игроку можно на его странице в панели наставника."
    )


async def _fulfill_shelf_star_item(db, message: Message, payment: dict) -> None:
    """Покупка = сразу выставление: инвентаря у наставника нет (§8.8)."""
    payment_id = payment["id"]
    meta = payment.get("meta") or {}
    partnership_id = payment.get("target_partnership_id")
    catalog_key = meta.get("catalog_key")
    price_drops = int(meta.get("price_drops") or 0)
    title = meta.get("title") or "Предмет от наставника"

    try:
        if not partnership_id or not catalog_key or price_drops < 1:
            raise ValueError(f"bad shelf_star_item data: pair={partnership_id} meta={meta}")
        row: dict = {
            "partnership_id": partnership_id,
            "type": "star_item",
            "title": title,
            "price_drops": price_drops,
            "status": "active",
            "star_catalog_key": catalog_key,
        }
        # Свободный текст звания едет из счёта в лот: RPC выкупа читает его
        # оттуда и ставит игроку (эконом-патч №1, лот `title`).
        if meta.get("title_text"):
            row["meta"] = {"title_text": meta["title_text"]}
        ins = await db.table("shelf_items").insert(row).execute()
        if not ins.data:
            raise ValueError("shelf_items insert returned no row")
        await _mark_fulfilled(db, payment_id)
    except Exception as e:
        logger.error("FULFILL SHELF ITEM FAILED payment=%s: %s", payment_id, e)
        await message.answer(
            "✅ Оплата получена. Предмет вот-вот появится на полке игрока. "
            f"Если не появится — напишите {SUPPORT_CONTACT} или отправьте /paysupport."
        )
        return

    await message.answer(
        f"🎁 «{title}» на полке игрока. Цена для игрока: <b>{price_drops}</b> 💧."
    )

    # Уведомить игрока о новом лоте (как в 8a: бот + in-app).
    try:
        pair = await (
            db.table("partnerships").select("player_id")
            .eq("id", partnership_id).maybe_single().execute()
        )
        player_id = pair.data.get("player_id") if (pair and pair.data) else None
        if player_id:
            await emit_notification(
                db, user_id=player_id, type="shelf_new_item",
                title="🎁 Новый предмет на полке",
                message=f"«{title}» — {price_drops} 💧",
                payload={"catalog_key": catalog_key},
            )
            tg = await (
                db.table("users").select("telegram_id")
                .eq("id", player_id).maybe_single().execute()
            )
            if tg and tg.data and tg.data.get("telegram_id"):
                await send_bot_message(
                    message.bot, int(tg.data["telegram_id"]),
                    f"🎁 Наставник положил на полку «{title}» за {price_drops} 💧.",
                )
    except Exception as e:
        logger.warning("player notify failed payment=%s: %s", payment_id, e)


# ---------------------------------------------------------------------------
# pre_checkout_query
# ---------------------------------------------------------------------------

@payments_router.pre_checkout_query()
async def handle_pre_checkout(query: PreCheckoutQuery) -> None:
    """Final gate before Telegram charges the user. Answer within 10 seconds."""
    try:
        db = await get_supabase()
        payment_id = query.invoice_payload

        res = await (
            db.table("payments")
            .select("id, status, amount_stars, target_partnership_id, product_type")
            .eq("id", payment_id)
            .maybe_single()
            .execute()
        )
        if not res or not res.data:
            await query.answer(ok=False, error_message="Платёж не найден. Начните покупку заново.")
            return

        p = res.data
        if p["status"] != "pending":
            await query.answer(ok=False, error_message="Этот счёт уже обработан. Начните покупку заново.")
            return
        if query.currency != "XTR":
            await query.answer(ok=False, error_message="Оплата возможна только звёздами Telegram.")
            return
        if query.total_amount != int(p["amount_stars"]):
            await query.answer(ok=False, error_message="Цена изменилась. Начните покупку заново.")
            return
        # Подписка и пакет капель партнёрства не требуют (капли ложатся в пул R);
        # лот полки адресный — пара должна быть жива на момент оплаты.
        product_type = p.get("product_type")
        if product_type in _NEEDS_PARTNERSHIP or p.get("target_partnership_id"):
            if not p.get("target_partnership_id") or not await _partnership_active(db, p["target_partnership_id"]):
                await query.answer(ok=False, error_message="Партнёрство больше не активно.")
                return

        await query.answer(ok=True)
    except Exception as e:
        logger.error("pre_checkout failed payload=%s: %s", query.invoice_payload, e)
        try:
            await query.answer(ok=False, error_message="Временная ошибка. Попробуйте ещё раз.")
        except Exception:
            pass


# ---------------------------------------------------------------------------
# successful_payment
# ---------------------------------------------------------------------------

@payments_router.message(F.successful_payment)
async def handle_successful_payment(message: Message) -> None:
    sp = message.successful_payment
    payment_id = sp.invoice_payload
    charge_id = sp.telegram_payment_charge_id
    db = await get_supabase()

    # Idempotent mark-paid: only the FIRST update (from 'pending') wins.
    paid_res = await (
        db.table("payments")
        .update({
            "status": "paid",
            "telegram_payment_charge_id": charge_id,
            "paid_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", payment_id)
        .eq("status", "pending")
        .execute()
    )
    if not paid_res.data:
        logger.info("successful_payment duplicate/ignored payment=%s", payment_id)
        return

    payment = paid_res.data[0]

    # Tier subscription payment (7.5) — fulfil on the Responsible.
    if _is_tier(payment.get("product_type")):
        await _fulfill_tier_payment(db, message, payment)
        return

    product_type = payment.get("product_type")
    if product_type == "drop_pack":
        await _fulfill_drop_pack(db, message, payment)
        return
    if product_type == "shelf_star_item":
        await _fulfill_shelf_star_item(db, message, payment)
        return

    logger.error("unknown product_type in fulfilment payment=%s type=%s", payment_id, product_type)
    await message.answer(
        "✅ Оплата получена, но товар не распознан. "
        f"Напишите {SUPPORT_CONTACT} или отправьте /paysupport — разберёмся."
    )


# ---------------------------------------------------------------------------
# Required Telegram commands for selling bots
# ---------------------------------------------------------------------------

@payments_router.message(Command("paysupport"))
async def handle_paysupport(message: Message) -> None:
    await message.answer(
        "💬 <b>Поддержка по оплате</b>\n\n"
        "Оплата проходит через звёзды Telegram (XTR). Если подписка, капли или "
        "предмет на полке не появились после оплаты, либо есть вопрос по возврату — "
        f"напишите администратору: {SUPPORT_CONTACT}. Возврат звёзд возможен по "
        "решению администратора.\n\n"
        "Укажите примерное время оплаты и имя игрока — так мы найдём платёж быстрее."
    )


@payments_router.message(Command("terms"))
async def handle_terms(message: Message) -> None:
    await message.answer(
        "📄 <b>Условия использования</b>\n\n"
        "Звёздами Telegram (XTR) оплачиваются: подписка наставника, пакеты капель "
        "для подарков игроку и предметы на полку игрока. Цифровой товар "
        "предоставляется сразу после оплаты.\n\n"
        f"Вопросы и возвраты — через поддержку: /paysupport ({SUPPORT_CONTACT})."
    )

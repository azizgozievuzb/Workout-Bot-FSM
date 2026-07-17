"""Aiogram handlers for Telegram Stars payments (task 7.4).

  * pre_checkout_query  — validate against the payment snapshot; MUST answer < 10s.
  * successful_payment  — idempotent mark-paid → fulfill (activate boost) → notify.
  * /paysupport, /terms — required commands for bots selling via Stars.

No automatic refunds: a fulfill failure leaves the payment 'paid' and asks the user
to contact support. Refunds are admin-only (admin_payments router).
"""
import logging
from datetime import datetime, timezone

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import Message, PreCheckoutQuery

from ..db.client import get_supabase
from ..services.bot_notify import send_bot_message
from ..services.boost_service import PRODUCT_TO_BOOST_TYPE, activate_boost

logger = logging.getLogger(__name__)

payments_router = Router(name="payments")

SUPPORT_CONTACT = "@conectionWorkout_bot"

_BOOST_LABEL = {"1_day": "24 часа", "1_week": "7 дней"}


async def _partnership_active(db, partnership_id: str) -> bool:
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await (
        db.table("partnerships")
        .select("id")
        .eq("id", partnership_id)
        .eq("status", "active")
        .gt("expires_at", now_iso)
        .maybe_single()
        .execute()
    )
    return bool(res and res.data)


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
            .select("id, status, amount_stars, target_partnership_id")
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
        if not p["target_partnership_id"] or not await _partnership_active(db, p["target_partnership_id"]):
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
    partnership_id = payment.get("target_partnership_id")
    boost_type = PRODUCT_TO_BOOST_TYPE.get(payment["product_type"])

    # Fulfill: activate the boost. On failure keep status='paid' (no auto-refund).
    try:
        if not partnership_id or not boost_type:
            raise ValueError(f"bad payment fulfilment data: partnership={partnership_id} product={payment['product_type']}")
        await activate_boost(db, partnership_id, boost_type)
        await (
            db.table("payments")
            .update({
                "status": "fulfilled",
                "fulfilled_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", payment_id)
            .execute()
        )
    except Exception as e:
        logger.error("FULFILL FAILED payment=%s: %s", payment_id, e)
        await message.answer(
            "✅ Оплата получена. Буст активируется автоматически. "
            f"Если возникнут проблемы — напишите {SUPPORT_CONTACT} или отправьте /paysupport."
        )
        return

    label = _BOOST_LABEL.get(boost_type, boost_type)

    # Confirm to the Responsible (buyer).
    await message.answer(f"✅ Буст X2 активирован для игрока на {label}. Спасибо за поддержку!")

    # Notify the Player.
    try:
        player_res = await (
            db.table("partnerships")
            .select("player_id")
            .eq("id", partnership_id)
            .maybe_single()
            .execute()
        )
        if player_res and player_res.data:
            tg_res = await (
                db.table("users")
                .select("telegram_id")
                .eq("id", player_res.data["player_id"])
                .maybe_single()
                .execute()
            )
            if tg_res and tg_res.data:
                await send_bot_message(
                    message.bot,
                    tg_res.data["telegram_id"],
                    f"⚡ Ваш Ответственный подарил вам буст X2 на {label}! Капли за тренировки удваиваются.",
                )
    except Exception as e:
        logger.warning("player notify failed payment=%s: %s", payment_id, e)


# ---------------------------------------------------------------------------
# Required Telegram commands for selling bots
# ---------------------------------------------------------------------------

@payments_router.message(Command("paysupport"))
async def handle_paysupport(message: Message) -> None:
    await message.answer(
        "💬 <b>Поддержка по оплате</b>\n\n"
        "Оплата проходит через звёзды Telegram (XTR). Если буст не активировался "
        "после оплаты или есть вопрос по возврату — напишите администратору: "
        f"{SUPPORT_CONTACT}. Возврат звёзд возможен по решению администратора.\n\n"
        "Укажите примерное время оплаты и имя игрока — так мы найдём платёж быстрее."
    )


@payments_router.message(Command("terms"))
async def handle_terms(message: Message) -> None:
    await message.answer(
        "📄 <b>Условия использования</b>\n\n"
        "Покупка бустов X2 оплачивается звёздами Telegram (XTR) и активирует "
        "удвоение капель игрока на выбранный срок (1 день или 1 неделя). "
        "Цифровой товар предоставляется сразу после оплаты.\n\n"
        f"Вопросы и возвраты — через поддержку: /paysupport ({SUPPORT_CONTACT})."
    )

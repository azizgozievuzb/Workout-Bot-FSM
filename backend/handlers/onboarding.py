"""Aiogram onboarding (7.5) — the bot is only an entry point.

/start            → welcome + «Открыть приложение» (пейволл живёт в Mini App).
/start inv_<code> → принять приглашение, спарить по user_id, поприветствовать игрока.

Опросы (язык/роль/пол/fitness/age/goal) и R/P-коды удалены — всё переехало в Mini App.
/paysupport и /terms живут в handlers/payments.py.
"""
import logging

from aiogram import Router, types
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext

from ..core.config import settings
from ..db.client import get_supabase
from ..keyboards.onboarding_keyboards import get_miniapp_keyboard
from ..services.invites import accept_invite

logger = logging.getLogger(__name__)

onboarding_router = Router(name="onboarding")

BOT_USERNAME = getattr(settings, "BOT_USERNAME", None) or "conectionWorkout_bot"


@onboarding_router.message(CommandStart())
async def cmd_start(message: types.Message, state: FSMContext) -> None:
    await state.clear()

    args = message.text.split(maxsplit=1)
    deeplink = args[1].strip() if len(args) > 1 else ""

    # Invite link: t.me/{bot}?start=inv_<code>
    if deeplink.startswith("inv_"):
        code = deeplink[4:]
        db = await get_supabase()
        result = await accept_invite(
            db, code,
            message.from_user.id,
            message.from_user.first_name,
            message.from_user.username,
        )
        if not result["ok"]:
            reasons = {
                "not_found": "Ссылка недействительна.",
                "used": "Эта ссылка уже использована.",
                "expired": "Срок действия ссылки истёк (7 дней). Попросите наставника прислать новую.",
                "self": "Нельзя активировать собственное приглашение.",
                "limit": "У наставника уже максимальное число игроков.",
            }
            await message.answer(reasons.get(result.get("reason"), "Ссылка недействительна."))
            return

        await message.answer(
            f"🎉 Вы присоединились к наставнику {result.get('responsible_name', '')}!\n\n"
            "Откройте приложение, чтобы пройти короткий опрос и начать тренировки:",
            reply_markup=get_miniapp_keyboard(),
        )
        return

    # Plain /start (renew/other startapp params are handled inside the Mini App).
    await message.answer(
        "👋 Добро пожаловать в Workout Bot!\n\n"
        "Откройте приложение, чтобы выбрать тариф и начать:",
        reply_markup=get_miniapp_keyboard(),
    )

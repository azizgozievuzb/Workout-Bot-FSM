"""/settings — deep-link в приложение (7.5).

Опрос игрока (fitness/age/goal) переехал в Mini App, поэтому бот просто открывает
приложение — там пользователь меняет настройки/цель.
"""
import logging

from aiogram import Router, types
from aiogram.filters import Command

from ..keyboards.onboarding_keyboards import get_miniapp_keyboard

logger = logging.getLogger(__name__)

settings_router = Router(name="settings")


@settings_router.message(Command("settings"))
async def cmd_settings(message: types.Message) -> None:
    await message.answer(
        "⚙️ Настройки открываются в приложении:",
        reply_markup=get_miniapp_keyboard(),
    )

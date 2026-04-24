"""
/settings — перепрохождение player-онбординга с шага fitness (gender не трогаем).

Сбрасывает onboarding_state в `player_fitness_setup`, чтобы обработчики из
onboarding.py (process_fitness → process_age → process_goal) снова активировались.
После ответа на goal auth-guard снимается (goal_update_required → FALSE).
"""
import logging

from aiogram import Router, types
from aiogram.filters import Command

from ..db.client import get_supabase
from ..keyboards.onboarding_keyboards import get_fitness_keyboard

logger = logging.getLogger(__name__)

settings_router = Router(name="settings")


@settings_router.message(Command("settings"))
async def cmd_settings(message: types.Message) -> None:
    db = await get_supabase()
    res = (
        await db.table("users")
        .select("id, role, gender")
        .eq("telegram_id", message.from_user.id)
        .maybe_single()
        .execute()
    )
    data = res.data if res is not None else None

    if not data or data.get("role") != "player":
        await message.answer("Команда доступна только для игроков.")
        return

    if not data.get("gender"):
        await message.answer("Сначала заверши основную регистрацию через P-код.")
        return

    await (
        db.table("users")
        .update({"onboarding_state": "player_fitness_setup"})
        .eq("telegram_id", message.from_user.id)
        .execute()
    )

    await message.answer(
        "Давай обновим твой профиль 💪\n\nКакой у тебя уровень физической подготовки?",
        reply_markup=get_fitness_keyboard(),
    )

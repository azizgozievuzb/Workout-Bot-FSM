"""Mini App → Bot bridge для онбординга.

Endpoint: POST /onboarding/wake
Используется когда player видит OnboardingBlockedScreen в Mini App.
Сразу шлёт игроку сообщение в боте с первым вопросом онбординга,
чтобы после закрытия Mini App не пришлось ничего набирать.
"""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...core.deps import get_bot, get_current_user
from ...db.client import get_supabase
from ...keyboards.onboarding_keyboards import get_fitness_keyboard
from ...services.bot_notify import send_bot_message

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class WakeResp(BaseModel):
    ok: bool


class CompleteReq(BaseModel):
    gender: Literal["male", "female"]
    fitness_level: Literal["beginner", "intermediate", "advanced"]
    age_range: Literal["<18", "18-25", "26-35", "36-45", "46-55", "55+"]
    goal: Literal["lose_weight", "build_muscle", "endurance", "health", "flexibility"]


@router.post("/complete", response_model=WakeResp)
async def complete_onboarding(body: CompleteReq, user: dict = Depends(get_current_user)) -> WakeResp:
    """Игрок проходит опрос внутри Mini App (7.5) — сохраняем профиль, снимаем гейт.

    Опрос — только для приглашённого игрока (has_player_access). Иначе → 403 NOT_PLAYER.
    """
    db = await get_supabase()

    access_res = await (
        db.table("users")
        .select("has_player_access")
        .eq("telegram_id", user["telegram_id"])
        .maybe_single()
        .execute()
    )
    if not access_res or not access_res.data or not access_res.data.get("has_player_access"):
        raise HTTPException(status_code=403, detail={"code": "NOT_PLAYER"})

    now_iso = datetime.now(timezone.utc).isoformat()
    res = await (
        db.table("users")
        .update({
            "gender": body.gender,
            "fitness_level": body.fitness_level,
            "age_range": body.age_range,
            "goal": body.goal,
            "goal_last_updated_at": now_iso,
            "goal_update_required": False,
            "onboarding_done": True,
            "onboarding_state": "onboardingComplete",
        })
        .eq("telegram_id", user["telegram_id"])
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})
    return WakeResp(ok=True)


@router.post("/wake", response_model=WakeResp)
async def wake_onboarding(
    user: dict = Depends(get_current_user),
) -> WakeResp:
    """Player жмёт «Пройти опрос» в Mini App → бот сразу шлёт первый вопрос."""
    db = await get_supabase()
    tg_id = user["telegram_id"]

    u = await (
        db.table("users")
        .select("id, has_player_access, gender")
        .eq("telegram_id", tg_id)
        .maybe_single()
        .execute()
    )
    if not u or not u.data:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})
    if not u.data.get("has_player_access"):
        raise HTTPException(status_code=403, detail={"code": "NOT_PLAYER"})
    if not u.data.get("gender"):
        raise HTTPException(
            status_code=422,
            detail={"code": "GENDER_MISSING", "message": "Сначала заверши основную регистрацию."},
        )

    # 1. Перевести в state player_fitness_setup
    await (
        db.table("users")
        .update({"onboarding_state": "player_fitness_setup"})
        .eq("telegram_id", tg_id)
        .execute()
    )

    # 2. Отправить первый вопрос с inline-клавиатурой
    bot = get_bot()
    if bot is not None:
        await send_bot_message(
            bot,
            tg_id,
            "Давай обновим профиль — это займёт 30 секунд.\n\n"
            "Какой у тебя уровень физической подготовки?",
            reply_markup=get_fitness_keyboard(),
        )

    return WakeResp(ok=True)

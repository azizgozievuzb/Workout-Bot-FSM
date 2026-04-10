"""
Aiogram handlers для онбординга v2.

Responsible flow: /start → promo_code → language → gender → player_name → link → done
Player flow:      /start PAIR_XXXXXX → validate → language → gender → survey → miniapp → done
Повторный визит:  /start → статус (без перезапуска онбординга)
/invite:          Responsible приглашает ещё одного игрока (проверяет лимит)
"""
from aiogram import F, Router, types
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from ..db.client import get_supabase
from ..keyboards.onboarding_keyboards import (
    get_gender_keyboard,
    get_language_keyboard,
    get_miniapp_keyboard,
    get_survey_keyboard,
)
from ..services.fsm.onboarding_fsm import OnboardingService

onboarding_router = Router(name="onboarding")

BOT_USERNAME = "conectionWorkout_bot"

_RESP_STATES = frozenset({"resp_promo", "resp_language", "resp_gender", "resp_player_name"})
_PLAYER_STATES = frozenset({"player_language", "player_gender", "player_survey"})


# ---------------------------------------------------------------------------
# Aiogram FSM state — используется только в /invite (отдельно от DB FSM)
# ---------------------------------------------------------------------------

class InviteForm(StatesGroup):
    waiting_for_player_name = State()


# ---------------------------------------------------------------------------
# Утилиты
# ---------------------------------------------------------------------------

async def upsert_user(telegram_user: types.User) -> None:
    db = await get_supabase()
    await (
        db.table("users")
        .upsert(
            {
                "telegram_id": telegram_user.id,
                "telegram_username": telegram_user.username,
                "first_name": telegram_user.first_name,
            },
            on_conflict="telegram_id",
            ignore_duplicates=True,
        )
        .execute()
    )


async def get_svc() -> OnboardingService:
    db = await get_supabase()
    return OnboardingService(db)


# ---------------------------------------------------------------------------
# /start
# ---------------------------------------------------------------------------

@onboarding_router.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext) -> None:
    await state.clear()
    await upsert_user(message.from_user)
    svc = await get_svc()

    args = message.text.split(maxsplit=1)
    deeplink = args[1].strip() if len(args) > 1 else ""

    db_state, _ = await svc.get_state(message.from_user.id)

    # Уже завершил онбординг
    if db_state == "onboardingComplete":
        await message.answer("Вы уже зарегистрированы. Используйте меню для продолжения.")
        return

    # --- PLAYER FLOW (deep link с PAIR_) ---
    if deeplink.startswith("PAIR_"):
        code = deeplink[5:]
        result = await svc.validate_pair_code(message.from_user.id, code)

        if not result["ok"]:
            reasons = {
                "already_player": "У вас уже есть ответственный.",
                "limit_reached": "У вашего ответственного уже максимальное количество игроков.",
                "link_expired": "Срок действия ссылки истёк (7 дней). Попросите ответственного отправить новую.",
            }
            await message.answer(reasons.get(result["reason"], "Ссылка недействительна."))
            return

        db = await get_supabase()
        await (
            db.table("users")
            .update({"onboarding_state": "player_language", "role": "player"})
            .eq("telegram_id", message.from_user.id)
            .execute()
        )
        await message.answer(
            f"Вы приглашены как Игрок от {result['responsible_name']}!\n"
            "Давайте пройдём регистрацию.\n\n"
            "Выберите язык / Tilni tanlang / Choose language:",
            reply_markup=get_language_keyboard(),
        )
        return

    # --- RESPONSIBLE FLOW (прямой /start) ---
    if db_state in _PLAYER_STATES:
        await message.answer(
            "Вы проходите регистрацию как Игрок. Продолжайте с текущего шага."
        )
        return

    # Всегда сбрасываем в resp_promo при /start (в т.ч. перезапуск в середине флоу)
    db = await get_supabase()
    await (
        db.table("users")
        .update({"onboarding_state": "resp_promo", "role": "responsible"})
        .eq("telegram_id", message.from_user.id)
        .execute()
    )
    await message.answer(
        "Добро пожаловать! Вы — Ответственный.\n"
        "Чтобы стать Игроком, нужна пригласительная ссылка от вашего ответственного.\n\n"
        "Введите промокод для активации:"
    )


# ---------------------------------------------------------------------------
# Language callback (resp_language → resp_gender | player_language → player_gender)
# ---------------------------------------------------------------------------

@onboarding_router.callback_query(F.data.startswith("lang_"))
async def process_language(callback: types.CallbackQuery) -> None:
    lang = callback.data.split("_")[1]
    svc = await get_svc()
    result = await svc.send_event(callback.from_user.id, {"type": "SET_LANG", "lang": lang})

    if result.error:
        await callback.answer("Ошибка. Попробуйте снова.")
        return

    await callback.message.edit_text(
        "Выберите пол / Jins / Gender:",
        reply_markup=get_gender_keyboard(),
    )
    await callback.answer()


# ---------------------------------------------------------------------------
# Gender callback (resp_gender → resp_player_name | player_gender → player_survey)
# ---------------------------------------------------------------------------

@onboarding_router.callback_query(F.data.startswith("gender_"))
async def process_gender(callback: types.CallbackQuery) -> None:
    gender = callback.data.split("_")[1]
    svc = await get_svc()
    result = await svc.send_event(callback.from_user.id, {"type": "SET_GENDER", "gender": gender})

    if result.error:
        await callback.answer("Ошибка. Попробуйте снова.")
        return

    if result.state == "resp_player_name":
        await callback.message.edit_text(
            "Введите имя человека, которому хотите отправить приглашение:"
        )
    elif result.state == "player_survey":
        await callback.message.edit_text(
            "Небольшой опрос о физподготовке.\n\nСколько раз в неделю вы тренировались раньше?",
            reply_markup=get_survey_keyboard(),
        )
    await callback.answer()


# ---------------------------------------------------------------------------
# Survey callback (player flow only: player_survey → onboardingComplete)
# ---------------------------------------------------------------------------

@onboarding_router.callback_query(F.data.startswith("survey_"))
async def process_survey(callback: types.CallbackQuery) -> None:
    answer_idx = int(callback.data.split("_")[1])
    window = [answer_idx, answer_idx + 1, answer_idx + 2]
    svc = await get_svc()
    await svc.send_event(callback.from_user.id, {"type": "SURVEY_COMPLETE", "window": window})

    # Явно помечаем как done (фото загружается в Mini App, не в боте)
    db = await get_supabase()
    await (
        db.table("users")
        .update({"onboarding_state": "onboardingComplete", "onboarding_done": True})
        .eq("telegram_id", callback.from_user.id)
        .execute()
    )

    await callback.message.edit_text(
        "Отлично! Теперь откройте приложение для загрузки фото.",
        reply_markup=get_miniapp_keyboard(),
    )
    await callback.answer()


# ---------------------------------------------------------------------------
# /invite — Responsible приглашает ещё одного игрока (проверяет лимит)
# Регистрируется ДО general text handler чтобы state-filter имел приоритет
# ---------------------------------------------------------------------------

@onboarding_router.message(InviteForm.waiting_for_player_name, F.text)
async def process_invite_player_name(message: types.Message, state: FSMContext) -> None:
    name = message.text.strip()
    if not name:
        await message.answer("Имя не может быть пустым. Попробуйте ещё раз:")
        return

    svc = await get_svc()
    code = await svc.generate_pair_code(message.from_user.id, name)
    link = f"https://t.me/{BOT_USERNAME}?start=PAIR_{code}"
    await state.clear()
    await message.answer(
        f"Ваша пригласительная ссылка:\n\n{link}\n\n"
        f"Отправьте эту ссылку игроку {name}.\n\n"
        f"⚠️ Ссылка действительна 7 дней. Если игрок не перейдёт по ней "
        f"в течение этого срока, она сгорит. Приложение не несёт "
        f"ответственности за неиспользованные ссылки."
    )


@onboarding_router.message(Command("invite"))
async def cmd_invite(message: types.Message, state: FSMContext) -> None:
    svc = await get_svc()
    db_state, _ = await svc.get_state(message.from_user.id)

    if db_state != "onboardingComplete":
        await message.answer("Завершите регистрацию сначала.")
        return

    db = await get_supabase()
    user_res = (
        await db.table("users")
        .select("role, subscription_tier")
        .eq("telegram_id", message.from_user.id)
        .single()
        .execute()
    )
    if user_res.data.get("role") != "responsible":
        await message.answer("Команда /invite доступна только Ответственным.")
        return

    current, limit = await svc.count_active_players(message.from_user.id)
    if current >= limit:
        tier = user_res.data.get("subscription_tier", "basic")
        upgrade_hint = " Для premium (3 игрока) — промокод TESTPRO." if tier == "basic" else ""
        await message.answer(
            f"Достигнут лимит игроков ({current}/{limit}).{upgrade_hint}"
        )
        return

    await state.set_state(InviteForm.waiting_for_player_name)
    await message.answer("Введите имя человека, которому хотите отправить приглашение:")


# ---------------------------------------------------------------------------
# General text handler: promo code (resp_promo) и player name (resp_player_name)
# Срабатывает ТОЛЬКО когда aiogram FSM не в InviteForm.waiting_for_player_name
# ---------------------------------------------------------------------------

@onboarding_router.message(F.text)
async def process_text_input(message: types.Message) -> None:
    if message.text.startswith("/"):
        return

    svc = await get_svc()
    db_state, _ = await svc.get_state(message.from_user.id)

    if db_state == "resp_promo":
        result = await svc.send_event(
            message.from_user.id,
            {"type": "SET_PROMO", "code": message.text.strip()},
        )
        if result.error == "invalid_promo":
            await message.answer("Неверный промокод. Попробуйте ещё раз.")
        else:
            await message.answer(
                "Промокод принят!\n\nВыберите язык / Tilni tanlang / Choose language:",
                reply_markup=get_language_keyboard(),
            )

    elif db_state == "resp_player_name":
        name = message.text.strip()
        if not name:
            await message.answer("Имя не может быть пустым. Попробуйте ещё раз:")
            return

        result = await svc.send_event(
            message.from_user.id,
            {"type": "SET_PLAYER_NAME", "name": name},
        )
        if result.error:
            await message.answer(f"Ошибка: {result.error}. Попробуйте ещё раз.")
            return

        try:
            code = await svc.generate_pair_code(message.from_user.id, name)
        except Exception as e:
            await message.answer(f"Ошибка генерации ссылки: {e}")
            return

        link = f"https://t.me/{BOT_USERNAME}?start=PAIR_{code}"
        await message.answer(
            f"Ваша пригласительная ссылка:\n\n{link}\n\n"
            f"Отправьте эту ссылку игроку {name}.\n\n"
            f"⚠️ Ссылка действительна 7 дней. Если игрок не перейдёт по ней "
            f"в течение этого срока, она сгорит. Приложение не несёт "
            f"ответственности за неиспользованные ссылки."
        )

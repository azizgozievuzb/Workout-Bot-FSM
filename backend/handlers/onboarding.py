"""
Aiogram handlers для onboardingMachine.
1:1 маппинг состояний FSM → handler.
"""
from aiogram import F, Router, types
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext

from ..db.client import get_supabase
from ..keyboards.onboarding_keyboards import (
    get_gender_keyboard,
    get_language_keyboard,
    get_pairing_code_keyboard,
    get_role_keyboard,
    get_survey_keyboard,
)
from ..services.fsm.onboarding_fsm import OnboardingService

onboarding_router = Router(name="onboarding")

# ---------------------------------------------------------------------------
# Утилита: создать или получить пользователя в БД
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
            ignore_duplicates=True,  # не затираем onboarding_state у существующих
        )
        .execute()
    )


async def get_onboarding_service() -> OnboardingService:
    db = await get_supabase()
    return OnboardingService(db)


# ---------------------------------------------------------------------------
# /start — точка входа
# ---------------------------------------------------------------------------

@onboarding_router.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext) -> None:
    await upsert_user(message.from_user)

    svc = await get_onboarding_service()
    current_state, _ = await svc.get_state(message.from_user.id)

    if current_state == "onboardingComplete":
        await message.answer("Добро пожаловать обратно! 👋")
        return

    # Начинаем / продолжаем онбординг
    await message.answer(
        "Добро пожаловать в Workout Bot! 🏋️\nВыберите язык / Tilni tanlang / Choose language:",
        reply_markup=get_language_keyboard(),
    )


# ---------------------------------------------------------------------------
# 1. languageSelection
# ---------------------------------------------------------------------------

@onboarding_router.callback_query(F.data.startswith("lang_"))
async def process_language(callback: types.CallbackQuery) -> None:
    lang = callback.data.split("_")[1]
    svc = await get_onboarding_service()

    result = await svc.send_event(
        callback.from_user.id,
        {"type": "SET_LANG", "lang": lang},
    )

    texts = {
        "ru": "Кто вы в этой системе?",
        "uz": "Siz bu tizimda kimsiz?",
        "en": "What is your role?",
    }
    text = texts.get(lang, texts["ru"])

    await callback.message.edit_text(text, reply_markup=get_role_keyboard(lang))
    await callback.answer()


# ---------------------------------------------------------------------------
# 2. roleSelection
# ---------------------------------------------------------------------------

@onboarding_router.callback_query(F.data.startswith("role_"))
async def process_role(callback: types.CallbackQuery) -> None:
    role = callback.data.split("_")[1]
    svc = await get_onboarding_service()

    await svc.send_event(
        callback.from_user.id,
        {"type": "SET_ROLE", "role": role},
    )

    await callback.message.edit_text(
        "Ваш пол / Your gender:",
        reply_markup=get_gender_keyboard(),
    )
    await callback.answer()


# ---------------------------------------------------------------------------
# 3. genderSelection → roleRouting (auto)
# ---------------------------------------------------------------------------

@onboarding_router.callback_query(F.data.startswith("gender_"))
async def process_gender(callback: types.CallbackQuery) -> None:
    gender = callback.data.split("_")[1]
    svc = await get_onboarding_service()

    result = await svc.send_event(
        callback.from_user.id,
        {"type": "SET_GENDER", "gender": gender},
    )

    # После gender FSM переходит в playerSurvey или responsiblePairing
    if result.state == "playerSurvey":
        await callback.message.edit_text(
            "📊 Небольшой опрос для настройки тренировок.\n\nСколько раз в неделю вы тренировались раньше?",
            reply_markup=get_survey_keyboard(),
        )
    elif result.state == "responsiblePairing":
        await callback.message.edit_text(
            "🔗 Введите код связки от вашего игрока.\nПопросите его открыть бот и поделиться кодом.",
        )

    await callback.answer()


# ---------------------------------------------------------------------------
# 4a. playerSurvey
# ---------------------------------------------------------------------------

@onboarding_router.callback_query(F.data.startswith("survey_"))
async def process_survey(callback: types.CallbackQuery) -> None:
    # survey_1, survey_2, survey_3 → window = [1,2,3] / [2,3,4] / [3,4,5]
    answer_idx = int(callback.data.split("_")[1])
    window = [answer_idx, answer_idx + 1, answer_idx + 2]

    svc = await get_onboarding_service()
    result = await svc.send_event(
        callback.from_user.id,
        {"type": "SURVEY_COMPLETE", "window": window},
    )

    await callback.message.edit_text(
        "📸 Загрузите селфи для профиля.\n"
        "Оно будет использоваться для рамок и аватарок в магазине.\n\n"
        "Просто отправьте фото в этот чат 👇",
    )
    await callback.answer()


# ---------------------------------------------------------------------------
# 4b. playerProfilePhoto
# ---------------------------------------------------------------------------

@onboarding_router.message(F.photo)
async def process_photo_upload(message: types.Message) -> None:
    svc = await get_onboarding_service()
    current_state, _ = await svc.get_state(message.from_user.id)

    if current_state != "playerProfilePhoto":
        return  # Фото в другом контексте — игнорируем

    # Берём самое качественное фото
    photo = message.photo[-1]
    file_id = photo.file_id

    # Сохраняем file_id как profile_photo_url (позже заменим на Supabase Storage URL)
    db = await get_supabase()
    await (
        db.table("users")
        .update({"profile_photo_url": f"tg://{file_id}"})
        .eq("telegram_id", message.from_user.id)
        .execute()
    )

    result = await svc.send_event(
        message.from_user.id,
        {"type": "PHOTO_UPLOADED"},
    )

    # Генерируем pairing code
    code = await svc.generate_pairing_code(message.from_user.id)

    await message.answer(
        f"✅ Фото загружено!\n\n"
        f"🔗 Ваш код для связки:\n\n"
        f"<code>{code}</code>\n\n"
        f"Отправьте этот код вашему Ответственному.",
        parse_mode="HTML",
        reply_markup=get_pairing_code_keyboard(code),
    )


# ---------------------------------------------------------------------------
# 5. responsiblePairing — ввод кода текстом
# ---------------------------------------------------------------------------

@onboarding_router.message(F.text & F.text.regexp(r"^[A-Fa-f0-9]{8}$"))
async def process_pairing_code_input(message: types.Message) -> None:
    svc = await get_onboarding_service()
    current_state, _ = await svc.get_state(message.from_user.id)

    if current_state != "responsiblePairing":
        return

    code = message.text.strip().upper()
    success = await svc.accept_pairing_code(message.from_user.id, code)

    if success:
        await svc.send_event(
            message.from_user.id,
            {"type": "VALIDATION_SUCCESS"},
        )
        await message.answer(
            "🎉 Связка установлена!\n\n"
            "Теперь вы можете отслеживать прогресс вашего игрока.",
        )
    else:
        await message.answer(
            "❌ Код не найден или уже использован.\nПопробуйте ещё раз:",
        )

"""
Aiogram handlers для онбординга v3.

Responsible flow: /start → promo_code (DB) → language → gender → player_name → link → done
Player flow:      /start PAIR_XXXXXX → validate → language → gender → survey → miniapp → done
Повторный визит:  /start → smart menu (зависит от состояния)
"""
import logging
import re

from aiogram import F, Router, types
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext

from ..db.client import get_supabase
from ..core.config import settings
from ..keyboards.onboarding_keyboards import (
    get_gender_keyboard,
    get_language_keyboard,
    get_miniapp_keyboard,
    get_survey_keyboard,
)
from ..services.fsm.onboarding_fsm import OnboardingService

logger = logging.getLogger(__name__)

onboarding_router = Router(name="onboarding")

BOT_USERNAME = getattr(settings, "BOT_USERNAME", None) or "conectionWorkout_bot"

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def get_share_keyboard(link: str) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(inline_keyboard=[
        [types.InlineKeyboardButton(text="📤 Поделиться ссылкой", switch_inline_query=link)],
    ])

_RESP_STATES = frozenset({"resp_promo", "resp_language", "resp_gender", "resp_player_name"})
_PLAYER_STATES = frozenset({"player_language", "player_gender", "player_survey"})

LINK_WARNING = (
    "⚠️ Ссылка действительна 7 дней. Если игрок не перейдёт по ней "
    "в течение этого срока, она сгорит. "
    "Приложение не несёт ответственности за неиспользованные ссылки."
)


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

    # ------------------------------------------------------------------
    # Уже завершил онбординг → smart menu
    # ------------------------------------------------------------------
    if db_state == "onboardingComplete":
        db = await get_supabase()
        user_res = (
            await db.table("users")
            .select("id, role")
            .eq("telegram_id", message.from_user.id)
            .single()
            .execute()
        )
        role = user_res.data.get("role")
        resp_uuid = user_res.data["id"]

        if role == "responsible":
            # Есть активный игрок → Mini App
            active = (
                await db.table("partnerships")
                .select("id")
                .eq("responsible_id", resp_uuid)
                .eq("status", "active")
                .execute()
            )
            if active.data:
                await message.answer(
                    "С возвращением! Ваш игрок привязан.",
                    reply_markup=get_miniapp_keyboard(),
                )
                return

            # Есть pending (не истёкшая) ссылка → показать её
            pending = (
                await db.table("partnerships")
                .select("pair_code, player_name, expires_at")
                .eq("responsible_id", resp_uuid)
                .eq("status", "pending")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if pending.data:
                p = pending.data[0]
                pair_code = p['pair_code']
                link = f"https://t.me/{BOT_USERNAME}?start=PAIR_{pair_code}"
                await message.answer(
                    f"✅ Ссылка для игрока {p['player_name']} создана!\n\n"
                    f"👇 Нажмите на ссылку, чтобы скопировать:\n"
                    f"<code>{link}</code>\n\n"
                    f"⚠️ Важно:\n"
                    f"• Ссылка действительна 7 дней\n"
                    f"• Ссылка одноразовая — ей может воспользоваться только один человек\n"
                    f"• Если по ссылке перейдёт не тот человек, отменить это будет нельзя\n"
                    f"• Будьте внимательны при отправке!",
                    parse_mode="HTML",
                    reply_markup=get_share_keyboard(link),
                )
                return

            # Нет ни игрока, ни pending ссылки → нужен новый промокод
            await db.table("users").update({
                "onboarding_state": "resp_promo",
                "onboarding_done": False,
            }).eq("telegram_id", message.from_user.id).execute()

            await message.answer(
                "У вас пока нет привязанного игрока.\n"
                "Введите новый промокод для активации:"
            )
            return

        # Игрок или другая роль → Mini App
        await message.answer(
            "С возвращением!",
            reply_markup=get_miniapp_keyboard(),
        )
        return

    # ------------------------------------------------------------------
    # NEW PROMO V2: deep link token (UUID format) → redirect to Mini App
    # ------------------------------------------------------------------
    if deeplink and UUID_RE.match(deeplink):
        mini_app_url = settings.MINI_APP_URL.rstrip("/")
        await message.answer(
            "Вас пригласили! Откройте приложение для активации:",
            reply_markup=types.InlineKeyboardMarkup(inline_keyboard=[
                [types.InlineKeyboardButton(
                    text="🚀 Открыть приложение",
                    url=f"https://t.me/{BOT_USERNAME}?startapp={deeplink}",
                )],
            ]),
        )
        return

    # ------------------------------------------------------------------
    # PLAYER FLOW (deep link с PAIR_) — legacy backward compat
    # ------------------------------------------------------------------
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
            .update({
                "onboarding_state": "player_language",
                "role": "player",
                "primary_role": "player",
                "has_player_access": True,
            })
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

    # ------------------------------------------------------------------
    # RESPONSIBLE FLOW (прямой /start)
    # ------------------------------------------------------------------
    if db_state in _PLAYER_STATES:
        await message.answer(
            "Вы проходите регистрацию как Игрок. Продолжайте с текущего шага."
        )
        return

    # Сбрасываем в resp_promo
    db = await get_supabase()
    await (
        db.table("users")
        .update({
            "onboarding_state": "resp_promo",
            "role": "responsible",
            "primary_role": "responsible",
            "has_responsible_access": True,
        })
        .eq("telegram_id", message.from_user.id)
        .execute()
    )
    await message.answer(
        "Добро пожаловать! Вы — Ответственный.\n"
        "Чтобы стать Игроком, нужна пригласительная ссылка от вашего ответственного.\n\n"
        "Введите промокод для активации:"
    )


# ---------------------------------------------------------------------------
# Language callback
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
# Gender callback
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
# Survey callback (player flow)
# ---------------------------------------------------------------------------

@onboarding_router.callback_query(F.data.startswith("survey_"))
async def process_survey(callback: types.CallbackQuery) -> None:
    answer_idx = int(callback.data.split("_")[1])
    window = [answer_idx, answer_idx + 1, answer_idx + 2]
    svc = await get_svc()
    await svc.send_event(callback.from_user.id, {"type": "SURVEY_COMPLETE", "window": window})

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
# General text handler: promo code + player name
# ---------------------------------------------------------------------------

@onboarding_router.message(F.text)
async def process_text_input(message: types.Message) -> None:
    svc = await get_svc()
    db_state, _ = await svc.get_state(message.from_user.id)

    # --- PROMO CODE (DB validation) ---
    if db_state == "resp_promo":
        # Block commands (/start caught by cmd_start above)
        if message.text.startswith('/'):
            await message.answer("Пожалуйста, введите только промокод.")
            return

        promo_result = await svc.validate_promo_code(
            message.from_user.id, message.text.strip()
        )

        if not promo_result["ok"]:
            if promo_result.get("reason") == "rate_limited" or promo_result.get("locked"):
                minutes = promo_result.get("minutes_left", 60)
                await message.answer(
                    f"❌ Слишком много попыток. Повторите через {minutes} мин."
                )
            elif promo_result.get("attempts_left") is not None:
                await message.answer(
                    f"Осталось {promo_result['attempts_left']} попыток, введите код повторно."
                )
            else:
                await message.answer("Неверный промокод.")
            return

        # Promo valid
        tier = promo_result["tier"]

        # Admin — skip full onboarding, go straight to complete
        if tier == "admin":
            await svc.db.table("users").update({
                "onboarding_state": "onboardingComplete",
                "onboarding_done": True,
            }).eq("telegram_id", message.from_user.id).execute()

            await message.answer(
                "🔑 Добро пожаловать, Админ!\n\nОткройте приложение:",
                reply_markup=get_miniapp_keyboard(),
            )
            return

        # Regular promo — send FSM event with tier from DB
        result = await svc.send_event(
            message.from_user.id,
            {"type": "SET_PROMO", "tier": tier},
        )
        if result.error:
            await message.answer("Ошибка обработки промокода. Попробуйте снова.")
            return

        await message.answer(
            "Промокод принят!\n\nВыберите язык / Tilni tanlang / Choose language:",
            reply_markup=get_language_keyboard(),
        )
        return

    # Ignore commands in other states
    if message.text.startswith("/"):
        return

    # --- PLAYER NAME → GENERATE LINK ---
    if db_state == "resp_player_name":
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
            logger.error("generate_pair_code failed for %s: %s", message.from_user.id, e)
            await message.answer("Ошибка генерации ссылки. Попробуйте /start заново.")
            return

        link = f"https://t.me/{BOT_USERNAME}?start=PAIR_{code}"
        await message.answer(
            f"✅ Ссылка для игрока {name} создана!\n\n"
            f"👇 Нажмите на ссылку, чтобы скопировать:\n"
            f"<code>{link}</code>\n\n"
            f"⚠️ Важно:\n"
            f"• Ссылка действительна 7 дней\n"
            f"• Ссылка одноразовая — ей может воспользоваться только один человек\n"
            f"• Если по ссылке перейдёт не тот человек, отменить это будет нельзя\n"
            f"• Будьте внимательны при отправке!",
            parse_mode="HTML",
            reply_markup=get_share_keyboard(link),
        )
        # Фикс 1: сразу показать кнопку приложения
        await message.answer(
            "Отлично! Теперь откройте приложение:",
            reply_markup=get_miniapp_keyboard(),
        )


# ---------------------------------------------------------------------------
# Non-text handler (stickers, photos, voice etc.) during promo input
# ---------------------------------------------------------------------------

@onboarding_router.message(~F.text)
async def handle_non_text_in_promo(message: types.Message) -> None:
    svc = await get_svc()
    db_state, _ = await svc.get_state(message.from_user.id)
    if db_state == "resp_promo":
        await message.answer("Пожалуйста, введите только промокод.")

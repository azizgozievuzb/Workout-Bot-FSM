"""
Aiogram handlers для онбординга v3.

Responsible flow: /start → promo_code (DB) → create user + P-code → Mini App → done
Player flow:      /start PAIR_XXXXXX → validate → language → gender → survey → miniapp → done
Повторный визит:  /start → smart menu (зависит от состояния)
"""
import logging
import re
import secrets
import string as _s
from datetime import datetime, timezone, timedelta

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

async def get_svc() -> OnboardingService:
    db = await get_supabase()
    return OnboardingService(db)


# ---------------------------------------------------------------------------
# /start
# ---------------------------------------------------------------------------

@onboarding_router.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext) -> None:
    await state.clear()
    svc = await get_svc()

    args = message.text.split(maxsplit=1)
    deeplink = args[1].strip() if len(args) > 1 else ""

    db_state, _ = await svc.get_state(message.from_user.id)
    # db_state is None either for new users (no row) or users with cleared state

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
        # Create or update user row — this is a legitimate entry point (invited player)
        await (
            db.table("users")
            .upsert(
                {
                    "telegram_id": message.from_user.id,
                    "telegram_username": message.from_user.username,
                    "first_name": message.from_user.first_name,
                    "onboarding_state": "player_language",
                    "role": "player",
                    "primary_role": "player",
                    "has_player_access": True,
                },
                on_conflict="telegram_id",
            )
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

    # New or returning user without valid state — prompt for promo code.
    # Do NOT create a user row here; it will be created after promo activation.
    await message.answer(
        "Добро пожаловать!\n\n"
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
    # db_state is None for new users (no row yet) or users with cleared/old state
    if db_state in ("resp_promo", None):
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

        # Promo valid — create user row if it doesn't exist yet.
        # This is the ONLY place new user rows are created for the responsible flow.
        tg = message.from_user
        db = await get_supabase()

        if promo_result.get("role") == "admin":
            # Check if admin already exists (any telegram_id)
            existing_admin = (
                await db.table("users")
                .select("id, telegram_id")
                .eq("is_admin", True)
                .maybe_single()
                .execute()
            )

            if existing_admin is not None and existing_admin.data:
                # Evict old device — update telegram_id on existing row
                await (
                    db.table("users")
                    .update({
                        "telegram_id": tg.id,
                        "telegram_username": tg.username,
                        "first_name": tg.first_name,
                        "access_tier": "elite",
                    })
                    .eq("id", existing_admin.data["id"])
                    .execute()
                )
            else:
                # First-time admin registration (or pre-created by /auth/register)
                await (
                    db.table("users")
                    .upsert(
                        {
                            "telegram_id": tg.id,
                            "telegram_username": tg.username,
                            "first_name": tg.first_name,
                            "is_admin": True,
                            "has_player_access": False,
                            "has_responsible_access": True,
                            "primary_role": "responsible",
                            "role": "responsible",
                            "access_tier": "elite",  # admin always Elite
                            "onboarding_state": "onboardingComplete",
                            "onboarding_done": True,
                        },
                        on_conflict="telegram_id",
                    )
                    .execute()
                )

            # Ensure admin has a player_code (Elite tier → PE prefix)
            try:
                await svc.create_player_invite_code(
                    message.from_user.id, tier="basic", access_tier="elite"
                )
            except Exception as e:
                logger.error("create_player_invite_code (admin) failed: %s", e)

            await message.answer(
                "🔑 Добро пожаловать, Админ!\n\nОткройте приложение:",
                reply_markup=get_miniapp_keyboard(),
            )
            return

        # Player code activation via bot
        if promo_result.get("role") == "player":
            responsible_id = promo_result.get("responsible_id")
            duration_days = int(promo_result.get("duration_days") or 30)
            p_access_tier = promo_result.get("access_tier") or "standard"
            promo_id = promo_result["promo_id"]

            # Self-invite guard
            existing_self = (
                await db.table("users")
                .select("id")
                .eq("telegram_id", tg.id)
                .maybe_single()
                .execute()
            )
            self_id = existing_self.data["id"] if (existing_self and existing_self.data) else None
            if self_id and self_id == responsible_id:
                await message.answer("Нельзя использовать свой собственный код.")
                return

            # Fetch responsible (name + tier for slot limit)
            resp_res = await (
                db.table("users")
                .select("first_name, access_tier")
                .eq("id", responsible_id)
                .maybe_single()
                .execute()
            )
            if not resp_res or not resp_res.data:
                await message.answer("Ответственный не найден.")
                return
            responsible_name = resp_res.data.get("first_name") or "Ответственный"
            resp_tier = resp_res.data.get("access_tier") or "standard"

            # Slot limit
            TIER_LIMITS = {"standard": 1, "premium": 2, "elite": 3}
            slot_limit = TIER_LIMITS.get(resp_tier, 1)
            count_res = await (
                db.table("partnerships")
                .select("id", count="exact")
                .eq("responsible_id", responsible_id)
                .eq("status", "active")
                .execute()
            )
            if (count_res.count or 0) >= slot_limit:
                await message.answer(f"У Ответственного достигнут лимит игроков ({slot_limit}).")
                return

            now = datetime.now(timezone.utc)
            expires_at = (now + timedelta(days=duration_days)).isoformat()

            # Upsert player user row
            await (
                db.table("users")
                .upsert(
                    {
                        "telegram_id": tg.id,
                        "telegram_username": tg.username,
                        "first_name": tg.first_name,
                        "role": "player",
                        "primary_role": "player",
                        "has_player_access": True,
                        "access_tier": p_access_tier,
                        "deactivated_at": None,
                        "scheduled_deletion_at": None,
                        "onboarding_state": "onboardingComplete",
                        "onboarding_done": True,
                    },
                    on_conflict="telegram_id",
                )
                .execute()
            )

            # Get fresh user_id
            user_row = (
                await db.table("users")
                .select("id")
                .eq("telegram_id", tg.id)
                .single()
                .execute()
            ).data
            player_id = user_row["id"]

            # Atomic mark code used
            mark = await (
                db.table("promo_codes")
                .update({
                    "is_used": True,
                    "used_by": player_id,
                    "used_at": now.isoformat(),
                    "activated_at": now.isoformat(),
                    "activated_by": tg.id,
                    "expires_at": expires_at,
                })
                .eq("id", promo_id)
                .eq("is_used", False)
                .execute()
            )
            if not mark.data:
                await message.answer("Этот код уже был активирован.")
                return

            # Create partnership
            _pc = "".join(secrets.choice(_s.ascii_uppercase + _s.digits) for _ in range(8))
            await (
                db.table("partnerships")
                .insert({
                    "player_id": player_id,
                    "responsible_id": responsible_id,
                    "status": "active",
                    "pairing_code": _pc,
                    "pair_code": _pc,
                })
                .execute()
            )

            # Auto-regen fresh P-code for Responsible (inherit tier)
            try:
                resp_tg_res = await db.table("users").select("telegram_id").eq("id", responsible_id).single().execute()
                await svc.create_player_invite_code(
                    resp_tg_res.data["telegram_id"],
                    tier=promo_result.get("tier") or "basic",
                    access_tier=p_access_tier,
                )
            except Exception as e:
                logger.error("auto-regen player code after bot activation failed: %s", e)

            await db.table("users").update({"promo_attempts": 0, "promo_locked_until": None}).eq("telegram_id", tg.id).execute()

            await message.answer(
                f"✅ Вы зарегистрированы как Игрок у {responsible_name}.\n\n"
                f"Откройте приложение:",
                reply_markup=get_miniapp_keyboard(),
            )
            return

        # Regular responsible promo — create user row + player P-code immediately
        tier = promo_result["tier"]
        access_tier = promo_result.get("access_tier", "standard")
        await (
            db.table("users")
            .upsert(
                {
                    "telegram_id": tg.id,
                    "telegram_username": tg.username,
                    "first_name": tg.first_name,
                    "role": "responsible",
                    "primary_role": "responsible",
                    "has_responsible_access": True,
                    "access_tier": access_tier,
                    "onboarding_state": "onboardingComplete",
                    "onboarding_done": True,
                },
                on_conflict="telegram_id",
            )
            .execute()
        )

        # Burn the R-promo (equivalent to previous burn_promo_code path)
        promo_id = promo_result.get("promo_id")
        if promo_id:
            user_res = await db.table("users").select("id").eq("telegram_id", tg.id).single().execute()
            user_id = user_res.data["id"]
            await (
                db.table("promo_codes")
                .update({
                    "is_used": True,
                    "used_by": user_id,
                    "used_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("id", promo_id)
                .eq("is_used", False)
                .execute()
            )

        # Create fresh prefixed P-code (PS/PP/PE) for the Responsible to invite a Player
        code_str = None
        try:
            code_str = await svc.create_player_invite_code(
                message.from_user.id, tier=tier, access_tier=access_tier,
            )
        except Exception as e:
            logger.error("create_player_invite_code failed: %s", e)

        # Reset promo attempts
        await db.table("users").update({"promo_attempts": 0, "promo_locked_until": None}).eq("telegram_id", tg.id).execute()

        if code_str:
            await message.answer(
                f"✅ Вы теперь Ответственный.\n\n"
                f"👇 Ваш код для приглашения игрока:\n<code>{code_str}</code>\n\n"
                f"Передайте его игроку — он введёт код в приложении.",
                parse_mode="HTML",
                reply_markup=get_miniapp_keyboard(),
            )
        else:
            await message.answer(
                "✅ Вы теперь Ответственный.\nОткройте приложение:",
                reply_markup=get_miniapp_keyboard(),
            )
        return

    # Ignore commands in other states
    if message.text.startswith("/"):
        return


# ---------------------------------------------------------------------------
# Non-text handler (stickers, photos, voice etc.) during promo input
# ---------------------------------------------------------------------------

@onboarding_router.message(~F.text)
async def handle_non_text_in_promo(message: types.Message) -> None:
    svc = await get_svc()
    db_state, _ = await svc.get_state(message.from_user.id)
    if db_state == "resp_promo":
        await message.answer("Пожалуйста, введите только промокод.")

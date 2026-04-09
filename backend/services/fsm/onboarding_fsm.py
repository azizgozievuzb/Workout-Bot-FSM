"""
OnboardingFSM — Python-реализация 101_onboardingMachine.ts.

Хранение состояния: Supabase (users.onboarding_state + users.*).
Каждый transition атомарно обновляет запись пользователя в БД.
"""
import secrets
from dataclasses import dataclass
from typing import Literal

from supabase import AsyncClient

OnboardingState = Literal[
    "languageSelection",
    "roleSelection",
    "genderSelection",
    "roleRouting",
    "playerSurvey",
    "playerProfilePhoto",
    "playerPairing",
    "responsiblePairing",
    "validatingCode",
    "onboardingComplete",
]


@dataclass
class TransitionResult:
    state: OnboardingState
    context: dict
    error: str | None = None


class OnboardingFSM:
    """
    1:1 маппинг с fsm_blueprints/101_onboardingMachine.ts.
    Метод transition() принимает event-dict и текущий контекст пользователя,
    возвращает новое состояние + обновлённый контекст.
    """

    # Guards
    @staticmethod
    def _is_player(ctx: dict) -> bool:
        return ctx.get("role") == "player"

    @staticmethod
    def _is_responsible(ctx: dict) -> bool:
        return ctx.get("role") == "responsible"

    def transition(
        self,
        current_state: OnboardingState,
        event: dict,
        context: dict,
    ) -> TransitionResult:
        ctx = context.copy()
        event_type = event.get("type")

        match current_state:
            case "languageSelection":
                if event_type == "SET_LANG":
                    ctx["lang"] = event["lang"]
                    return TransitionResult(state="roleSelection", context=ctx)

            case "roleSelection":
                if event_type == "SET_ROLE":
                    ctx["role"] = event["role"]
                    return TransitionResult(state="genderSelection", context=ctx)

            case "genderSelection":
                if event_type == "SET_GENDER":
                    ctx["gender"] = event["gender"]
                    # auto-transition через roleRouting
                    next_state = (
                        "playerSurvey" if self._is_player(ctx) else "responsiblePairing"
                    )
                    return TransitionResult(state=next_state, context=ctx)

            case "playerSurvey":
                if event_type == "SURVEY_COMPLETE":
                    ctx["starting_window"] = event.get("window")
                    return TransitionResult(state="playerProfilePhoto", context=ctx)

            case "playerProfilePhoto":
                if event_type == "PHOTO_UPLOADED":
                    ctx["has_profile_photo"] = True
                    return TransitionResult(state="playerPairing", context=ctx)

            case "playerPairing":
                if event_type == "PAIRING_SUCCESS":
                    return TransitionResult(state="onboardingComplete", context=ctx)

            case "responsiblePairing":
                if event_type == "ENTER_PAIRING_CODE":
                    ctx["entered_code"] = event.get("code")
                    return TransitionResult(state="validatingCode", context=ctx)

            case "validatingCode":
                if event_type == "VALIDATION_SUCCESS":
                    return TransitionResult(state="onboardingComplete", context=ctx)
                if event_type == "VALIDATION_ERROR":
                    return TransitionResult(state="responsiblePairing", context=ctx)

        # Невалидный event для текущего состояния
        return TransitionResult(
            state=current_state,
            context=ctx,
            error=f"Unexpected event '{event_type}' in state '{current_state}'",
        )


class OnboardingService:
    """
    Высокоуровневый сервис — работает с Supabase.
    Handlers вызывают именно его, не FSM напрямую.
    """

    def __init__(self, db: AsyncClient):
        self.db = db
        self.fsm = OnboardingFSM()

    async def get_state(self, telegram_id: int) -> tuple[OnboardingState, dict]:
        """Возвращает (текущее_состояние, контекст) из БД."""
        result = (
            await self.db.table("users")
            .select("onboarding_state, lang, role, gender, profile_photo_url")
            .eq("telegram_id", telegram_id)
            .single()
            .execute()
        )
        data = result.data
        state: OnboardingState = data.get("onboarding_state", "languageSelection")
        ctx = {
            "lang": data.get("lang"),
            "role": data.get("role"),
            "gender": data.get("gender"),
            "has_profile_photo": bool(data.get("profile_photo_url")),
        }
        return state, ctx

    async def send_event(self, telegram_id: int, event: dict) -> TransitionResult:
        """Переход FSM + запись в БД."""
        state, ctx = await self.get_state(telegram_id)
        result = self.fsm.transition(state, event, ctx)

        if result.error:
            return result

        # Обновляем пользователя в БД
        update_data: dict = {"onboarding_state": result.state}
        if result.state == "onboardingComplete":
            update_data["onboarding_done"] = True

        # Сохраняем поля контекста, которые изменились
        if result.context.get("lang") != ctx.get("lang"):
            update_data["lang"] = result.context["lang"]
        if result.context.get("role") != ctx.get("role"):
            update_data["role"] = result.context["role"]
        if result.context.get("gender") != ctx.get("gender"):
            update_data["gender"] = result.context["gender"]

        await (
            self.db.table("users")
            .update(update_data)
            .eq("telegram_id", telegram_id)
            .execute()
        )

        return result

    async def generate_pairing_code(self, telegram_id: int) -> str:
        """
        Генерирует уникальный 8-символьный pairing code для Player.
        Создаёт запись в partnerships со статусом 'pending'.
        """
        # Получаем user.id по telegram_id
        user_res = (
            await self.db.table("users")
            .select("id")
            .eq("telegram_id", telegram_id)
            .single()
            .execute()
        )
        user_id = user_res.data["id"]

        # Генерируем уникальный код (до 5 попыток)
        for _ in range(5):
            code = secrets.token_hex(4).upper()  # 8 символов hex
            exists = (
                await self.db.table("partnerships")
                .select("id")
                .eq("pairing_code", code)
                .execute()
            )
            if not exists.data:
                break

        await (
            self.db.table("partnerships")
            .insert({
                "player_id": user_id,
                "pairing_code": code,
                "status": "pending",
            })
            .execute()
        )

        # Инициализируем player_stats
        await (
            self.db.table("player_stats")
            .upsert({"player_id": user_id})
            .execute()
        )

        return code

    async def accept_pairing_code(self, responsible_telegram_id: int, code: str) -> bool:
        """
        Responsible вводит код игрока.
        Обновляет partnerships.responsible_id, статус → 'active'.
        Возвращает True при успехе.
        """
        # Получаем responsible user.id
        resp_res = (
            await self.db.table("users")
            .select("id")
            .eq("telegram_id", responsible_telegram_id)
            .single()
            .execute()
        )
        responsible_id = resp_res.data["id"]

        # Ищем pending partnership по коду
        pair_res = (
            await self.db.table("partnerships")
            .select("id, player_id, status")
            .eq("pairing_code", code.upper())
            .single()
            .execute()
        )

        if not pair_res.data:
            return False  # код не найден

        pair = pair_res.data
        if pair["status"] != "pending":
            return False  # уже использован

        # Привязываем Responsible
        await (
            self.db.table("partnerships")
            .update({"responsible_id": responsible_id, "status": "active"})
            .eq("id", pair["id"])
            .execute()
        )

        return True

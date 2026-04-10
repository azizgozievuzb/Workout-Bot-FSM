"""
OnboardingFSM v2 — Python-реализация нового онбординга.

Responsible flow: resp_promo → resp_language → resp_gender → resp_player_name → onboardingComplete
Player flow:      player_language → player_gender → player_survey → onboardingComplete
"""
import random
import string
from dataclasses import dataclass
from typing import Literal

from supabase import AsyncClient

# Промокоды → subscription_tier
PROMO_CODES: dict[str, str] = {
    "WORKOUT2026": "basic",
    "BETA100": "basic",
    "TESTPRO": "premium",
}

PLAYER_LIMITS: dict[str, int] = {
    "basic": 1,
    "premium": 3,
}

# Состояния старой FSM (миграция данных)
_OLD_STATES = frozenset({
    "languageSelection", "roleSelection", "genderSelection", "roleRouting",
    "playerSurvey", "playerProfilePhoto", "playerPairing",
    "responsiblePairing", "validatingCode",
})

OnboardingState = Literal[
    # Responsible flow
    "resp_promo",
    "resp_language",
    "resp_gender",
    "resp_player_name",
    # Player flow
    "player_language",
    "player_gender",
    "player_survey",
    # Terminal
    "onboardingComplete",
]


@dataclass
class TransitionResult:
    state: OnboardingState
    context: dict
    error: str | None = None


class OnboardingFSM:
    def transition(
        self,
        current_state: OnboardingState,
        event: dict,
        context: dict,
    ) -> TransitionResult:
        ctx = context.copy()
        event_type = event.get("type")

        match current_state:
            # --- RESPONSIBLE FLOW ---
            case "resp_promo":
                if event_type == "SET_PROMO":
                    tier = PROMO_CODES.get(event.get("code", "").upper())
                    if not tier:
                        return TransitionResult(state="resp_promo", context=ctx, error="invalid_promo")
                    ctx["subscription_tier"] = tier
                    return TransitionResult(state="resp_language", context=ctx)

            case "resp_language":
                if event_type == "SET_LANG":
                    ctx["lang"] = event["lang"]
                    return TransitionResult(state="resp_gender", context=ctx)

            case "resp_gender":
                if event_type == "SET_GENDER":
                    ctx["gender"] = event["gender"]
                    return TransitionResult(state="resp_player_name", context=ctx)

            case "resp_player_name":
                if event_type == "SET_PLAYER_NAME":
                    ctx["player_name"] = event.get("name", "")
                    return TransitionResult(state="onboardingComplete", context=ctx)

            # --- PLAYER FLOW ---
            case "player_language":
                if event_type == "SET_LANG":
                    ctx["lang"] = event["lang"]
                    return TransitionResult(state="player_gender", context=ctx)

            case "player_gender":
                if event_type == "SET_GENDER":
                    ctx["gender"] = event["gender"]
                    return TransitionResult(state="player_survey", context=ctx)

            case "player_survey":
                if event_type == "SURVEY_COMPLETE":
                    ctx["starting_window"] = event.get("window")
                    return TransitionResult(state="onboardingComplete", context=ctx)

        return TransitionResult(
            state=current_state,
            context=ctx,
            error=f"Unexpected event '{event_type}' in state '{current_state}'",
        )


class OnboardingService:
    def __init__(self, db: AsyncClient):
        self.db = db
        self.fsm = OnboardingFSM()

    async def get_state(self, telegram_id: int) -> tuple[OnboardingState | None, dict]:
        """Возвращает (текущее_состояние | None, контекст) из БД.
        None означает свежего пользователя без активного флоу."""
        result = (
            await self.db.table("users")
            .select("onboarding_state, lang, role, gender, subscription_tier")
            .eq("telegram_id", telegram_id)
            .single()
            .execute()
        )
        data = result.data
        state_raw = data.get("onboarding_state")

        # None или устаревшее состояние → свежий пользователь
        if not state_raw or state_raw in _OLD_STATES:
            state = None
        else:
            state = state_raw

        ctx = {
            "lang": data.get("lang"),
            "role": data.get("role"),
            "gender": data.get("gender"),
            "subscription_tier": data.get("subscription_tier", "basic"),
        }
        return state, ctx

    async def send_event(self, telegram_id: int, event: dict) -> TransitionResult:
        """Переход FSM + атомарная запись в БД."""
        state, ctx = await self.get_state(telegram_id)

        # Если нет активного состояния, инициализируем resp_promo
        if state is None:
            state = "resp_promo"

        result = self.fsm.transition(state, event, ctx)

        if result.error:
            return result

        update_data: dict = {"onboarding_state": result.state}
        if result.state == "onboardingComplete":
            update_data["onboarding_done"] = True

        for field in ("lang", "gender", "subscription_tier", "role"):
            if result.context.get(field) != ctx.get(field):
                update_data[field] = result.context[field]

        await (
            self.db.table("users")
            .update(update_data)
            .eq("telegram_id", telegram_id)
            .execute()
        )

        return result

    async def generate_pair_code(self, responsible_telegram_id: int, player_name: str) -> str:
        """
        Генерирует уникальный 6-символьный pair_code для Responsible.
        Создаёт запись в partnerships (status='pending', player_id=NULL).
        """
        resp_res = (
            await self.db.table("users")
            .select("id")
            .eq("telegram_id", responsible_telegram_id)
            .single()
            .execute()
        )
        responsible_id = resp_res.data["id"]

        chars = string.ascii_uppercase + string.digits
        code = ""
        for _ in range(10):
            code = "".join(random.choices(chars, k=6))
            exists = (
                await self.db.table("partnerships")
                .select("id")
                .eq("pair_code", code)
                .execute()
            )
            if not exists.data:
                break

        await (
            self.db.table("partnerships")
            .insert({
                "responsible_id": responsible_id,
                "pair_code": code,
                "player_name": player_name,
                "status": "pending",
            })
            .execute()
        )

        return code

    async def validate_pair_code(self, player_telegram_id: int, code: str) -> dict:
        """
        Валидирует pair_code при переходе игрока по deep link.
        Возвращает {"ok": True, "responsible_name": str} или {"ok": False, "reason": str}.
        """
        player_res = (
            await self.db.table("users")
            .select("id")
            .eq("telegram_id", player_telegram_id)
            .single()
            .execute()
        )
        player_id = player_res.data["id"]

        # Уже является активным игроком у кого-то
        existing = (
            await self.db.table("partnerships")
            .select("id")
            .eq("player_id", player_id)
            .eq("status", "active")
            .execute()
        )
        if existing.data:
            return {"ok": False, "reason": "already_player"}

        # Ищем partnership по коду
        pair_res = (
            await self.db.table("partnerships")
            .select("id, responsible_id, status")
            .eq("pair_code", code.upper())
            .execute()
        )
        if not pair_res.data or pair_res.data[0]["status"] != "pending":
            return {"ok": False, "reason": "invalid_code"}

        pair = pair_res.data[0]
        responsible_id = pair["responsible_id"]

        # Проверяем лимит игроков у Responsible
        resp_res = (
            await self.db.table("users")
            .select("subscription_tier, first_name")
            .eq("id", responsible_id)
            .single()
            .execute()
        )
        tier = resp_res.data.get("subscription_tier", "basic")
        limit = PLAYER_LIMITS.get(tier, 1)

        active_count = (
            await self.db.table("partnerships")
            .select("id")
            .eq("responsible_id", responsible_id)
            .eq("status", "active")
            .execute()
        )
        if len(active_count.data) >= limit:
            return {"ok": False, "reason": "limit_reached"}

        # Привязываем игрока
        await (
            self.db.table("partnerships")
            .update({"player_id": player_id, "status": "active"})
            .eq("id", pair["id"])
            .execute()
        )

        return {
            "ok": True,
            "responsible_name": resp_res.data.get("first_name") or "Ответственный",
        }

    async def count_active_players(self, responsible_telegram_id: int) -> tuple[int, int]:
        """Возвращает (текущее_кол-во, лимит) для Responsible."""
        resp_res = (
            await self.db.table("users")
            .select("id, subscription_tier")
            .eq("telegram_id", responsible_telegram_id)
            .single()
            .execute()
        )
        responsible_id = resp_res.data["id"]
        tier = resp_res.data.get("subscription_tier", "basic")
        limit = PLAYER_LIMITS.get(tier, 1)

        active = (
            await self.db.table("partnerships")
            .select("id")
            .eq("responsible_id", responsible_id)
            .eq("status", "active")
            .execute()
        )
        return len(active.data), limit

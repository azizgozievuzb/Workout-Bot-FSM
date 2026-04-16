"""
OnboardingFSM v3 — одноразовые промокоды из БД, 7-дневный TTL ссылок, brute-force защита.

Responsible flow: resp_promo → resp_language → resp_gender → resp_player_name → onboardingComplete
Player flow:      player_language → player_gender → player_survey → onboardingComplete
"""
import random
import string
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from supabase import AsyncClient

PAIR_LINK_TTL_DAYS = 7
MAX_PROMO_ATTEMPTS = 3  # per hour
PROMO_LOCKOUT_HOURS = 1

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
    "resp_promo",
    "resp_language",
    "resp_gender",
    "resp_player_name",
    "player_language",
    "player_gender",
    "player_survey",
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
            case "resp_promo":
                if event_type == "SET_PROMO":
                    # Tier уже провалидирован в OnboardingService.validate_promo_code
                    tier = event.get("tier")
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

    # ------------------------------------------------------------------
    # State helpers
    # ------------------------------------------------------------------

    async def get_state(self, telegram_id: int) -> tuple[OnboardingState | None, dict]:
        try:
            result = (
                await self.db.table("users")
                .select("onboarding_state, lang, role, gender, subscription_tier")
                .eq("telegram_id", telegram_id)
                .maybe_single()
                .execute()
            )
        except Exception:
            return None, {}
        if result is None or getattr(result, "data", None) is None:
            return None, {}
        data = result.data

        state_raw = data.get("onboarding_state")

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
        state, ctx = await self.get_state(telegram_id)

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

    # ------------------------------------------------------------------
    # Promo code validation (DB-based, one-time use)
    # ------------------------------------------------------------------

    async def check_promo_rate_limit(self, telegram_id: int) -> dict:
        """Check if user is rate-limited for promo attempts.
        Returns {"allowed": True} or {"allowed": False, "minutes_left": int}."""
        try:
            user_res = (
                await self.db.table("users")
                .select("promo_attempts, promo_locked_until")
                .eq("telegram_id", telegram_id)
                .maybe_single()
                .execute()
            )
        except Exception:
            return {"allowed": True}
        data = user_res.data if user_res is not None else None
        # New user with no row — no history to check, allow
        if data is None:
            return {"allowed": True}
        locked_until_str = data.get("promo_locked_until")

        if locked_until_str:
            locked_until = datetime.fromisoformat(locked_until_str)
            now = datetime.now(timezone.utc)
            if now < locked_until:
                minutes_left = int((locked_until - now).total_seconds() / 60) + 1
                return {"allowed": False, "minutes_left": minutes_left}
            else:
                # Lock expired — reset
                await (
                    self.db.table("users")
                    .update({"promo_attempts": 0, "promo_locked_until": None})
                    .eq("telegram_id", telegram_id)
                    .execute()
                )

        return {"allowed": True}

    async def record_failed_promo_attempt(self, telegram_id: int) -> dict:
        """Increment failed attempts. Returns {"locked": bool, "attempts_left": int}."""
        try:
            user_res = (
                await self.db.table("users")
                .select("promo_attempts")
                .eq("telegram_id", telegram_id)
                .maybe_single()
                .execute()
            )
        except Exception:
            return {"locked": False, "attempts_left": MAX_PROMO_ATTEMPTS - 1}
        data = user_res.data if user_res is not None else None
        # New user with no row — can't track attempts, just count this as first failure
        if data is None:
            return {"locked": False, "attempts_left": MAX_PROMO_ATTEMPTS - 1}
        attempts = (data.get("promo_attempts") or 0) + 1

        update_data: dict = {"promo_attempts": attempts}
        if attempts >= MAX_PROMO_ATTEMPTS:
            locked_until = datetime.now(timezone.utc) + timedelta(hours=PROMO_LOCKOUT_HOURS)
            update_data["promo_locked_until"] = locked_until.isoformat()

        await (
            self.db.table("users")
            .update(update_data)
            .eq("telegram_id", telegram_id)
            .execute()
        )

        if attempts >= MAX_PROMO_ATTEMPTS:
            return {"locked": True, "attempts_left": 0}
        return {"locked": False, "attempts_left": MAX_PROMO_ATTEMPTS - attempts}

    async def validate_promo_code(self, telegram_id: int, code: str) -> dict:
        """Validate promo code from DB or admin env.
        Returns {"ok": True, "tier": str, "promo_id": str} or {"ok": False, "reason": str, ...}."""

        # 1. Rate limit check
        rate = await self.check_promo_rate_limit(telegram_id)
        if not rate["allowed"]:
            return {
                "ok": False,
                "reason": "rate_limited",
                "minutes_left": rate["minutes_left"],
            }

        # 1.5. Check admin promo code from env
        from ...core.config import settings
        if settings.ADMIN_PROMO_CODE and code.strip() == settings.ADMIN_PROMO_CODE:
            # Fields will be applied in handler via upsert (handles both new and existing users)
            return {"ok": True, "tier": "admin", "promo_id": None}

        # 2. Look up code in DB
        promo_res = (
            await self.db.table("promo_codes")
            .select("id, tier, is_used")
            .eq("code", code.strip())
            .execute()
        )

        if not promo_res.data:
            fail = await self.record_failed_promo_attempt(telegram_id)
            return {
                "ok": False,
                "reason": "invalid_promo",
                "locked": fail["locked"],
                "attempts_left": fail["attempts_left"],
            }

        promo = promo_res.data[0]

        if promo["is_used"]:
            fail = await self.record_failed_promo_attempt(telegram_id)
            return {
                "ok": False,
                "reason": "promo_already_used",
                "locked": fail["locked"],
                "attempts_left": fail["attempts_left"],
            }

        # 3. Valid! Save pending_promo_id on user if row exists (new users get this after INSERT)
        user_res = (
            await self.db.table("users")
            .select("id")
            .eq("telegram_id", telegram_id)
            .maybe_single()
            .execute()
        )
        if user_res is not None and user_res.data is not None:
            await (
                self.db.table("users")
                .update({
                    "pending_promo_id": promo["id"],
                    "promo_attempts": 0,
                    "promo_locked_until": None,
                })
                .eq("telegram_id", telegram_id)
                .execute()
            )

        return {"ok": True, "tier": promo["tier"], "promo_id": promo["id"]}

    async def burn_promo_code(self, telegram_id: int) -> None:
        """Mark the pending promo code as used. Called after link is generated."""
        user_res = (
            await self.db.table("users")
            .select("id, pending_promo_id")
            .eq("telegram_id", telegram_id)
            .single()
            .execute()
        )
        promo_id = user_res.data.get("pending_promo_id")
        if not promo_id:
            return

        user_id = user_res.data["id"]
        await (
            self.db.table("promo_codes")
            .update({
                "is_used": True,
                "used_by": user_id,
                "used_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", promo_id)
            .execute()
        )
        await (
            self.db.table("users")
            .update({"pending_promo_id": None})
            .eq("telegram_id", telegram_id)
            .execute()
        )

    # ------------------------------------------------------------------
    # Player invite code (promo_codes with code_type='player') — mini-app
    # ------------------------------------------------------------------

    async def create_player_invite_code(
        self, responsible_telegram_id: int, tier: str = "basic"
    ) -> str | None:
        """Create a player_code row in promo_codes so /promo/my-player-code
        returns a valid code for the mini-app. Idempotent: if an unused code
        already exists for this responsible, returns it instead of creating."""
        resp_res = (
            await self.db.table("users")
            .select("id")
            .eq("telegram_id", responsible_telegram_id)
            .maybe_single()
            .execute()
        )
        if not resp_res or not resp_res.data:
            return None
        responsible_id = resp_res.data["id"]

        # Return existing unused code if present
        existing = (
            await self.db.table("promo_codes")
            .select("code")
            .eq("responsible_id", responsible_id)
            .eq("code_type", "player")
            .eq("is_used", False)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]["code"]

        chars = string.ascii_uppercase + string.digits
        code_str = "".join(random.choices(chars, k=8))
        token = str(uuid.uuid4())

        await (
            self.db.table("promo_codes")
            .insert({
                "code": code_str,
                "code_type": "player",
                "tier": tier,
                "responsible_id": responsible_id,
                "deep_link_token": token,
                "is_used": False,
            })
            .execute()
        )
        return code_str

    # ------------------------------------------------------------------
    # Pair code (invite link)
    # ------------------------------------------------------------------

    async def generate_pair_code(self, responsible_telegram_id: int, player_name: str) -> str:
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

        expires_at = (datetime.now(timezone.utc) + timedelta(days=PAIR_LINK_TTL_DAYS)).isoformat()

        await (
            self.db.table("partnerships")
            .insert({
                "responsible_id": responsible_id,
                "pairing_code": code,
                "pair_code": code,
                "player_name": player_name,
                "status": "pending",
                "expires_at": expires_at,
            })
            .execute()
        )

        # Burn the promo code — link generated successfully
        await self.burn_promo_code(responsible_telegram_id)

        return code

    # ------------------------------------------------------------------
    # Pair code validation (player deep link)
    # ------------------------------------------------------------------

    async def validate_pair_code(self, player_telegram_id: int, code: str) -> dict:
        player_res = (
            await self.db.table("users")
            .select("id")
            .eq("telegram_id", player_telegram_id)
            .single()
            .execute()
        )
        player_id = player_res.data["id"]

        existing = (
            await self.db.table("partnerships")
            .select("id")
            .eq("player_id", player_id)
            .eq("status", "active")
            .execute()
        )
        if existing.data:
            return {"ok": False, "reason": "already_player"}

        pair_res = (
            await self.db.table("partnerships")
            .select("id, responsible_id, status, expires_at")
            .eq("pair_code", code.upper())
            .execute()
        )
        if not pair_res.data or pair_res.data[0]["status"] != "pending":
            return {"ok": False, "reason": "invalid_code"}

        # Check expiry
        expires_at_str = pair_res.data[0].get("expires_at")
        if expires_at_str:
            expires_at = datetime.fromisoformat(expires_at_str)
            if datetime.now(timezone.utc) > expires_at:
                await (
                    self.db.table("partnerships")
                    .update({"status": "expired"})
                    .eq("id", pair_res.data[0]["id"])
                    .execute()
                )
                return {"ok": False, "reason": "link_expired"}

        pair = pair_res.data[0]
        responsible_id = pair["responsible_id"]

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

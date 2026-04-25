"""POST /auth/telegram — валидирует initData, возвращает JWT."""
import math
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ...core.security import create_access_token, validate_init_data
from ...db.client import get_supabase

router = APIRouter(prefix="/auth", tags=["auth"])

SHELL_ROLE = "new"  # временная роль для незарегистрированных пользователей

USER_SELECT_COLS = (
    "id, role, onboarding_done, profile_photo_url, photo_dark_url, photo_light_url, "
    "primary_role, has_player_access, has_responsible_access, is_admin, "
    "ban_until, ban_reason, ban_missed_workouts, "
    "responsible_access_tier, player_access_tier, "
    "shop_freeze_balance, gift_freeze_balance, gender, "
    "goal, goal_update_required"
)


ONBOARDING_REQUIRED_MESSAGE = "Вернись в бот, ответь на 3 вопроса (/settings)."


def _is_onboarding_blocked(user_data: dict) -> bool:
    """
    Player завершил P-код активацию и имеет role='player', но цель ещё
    не проставлена (или сработал Job H → goal_update_required=TRUE).
    Возвращает True если Mini App должен показать OnboardingBlockedScreen.
    JWT всё равно выдаётся, чтобы /onboarding/wake мог сработать.
    """
    if user_data.get("role") != "player":
        return False
    goal = user_data.get("goal")
    goal_update_required = bool(user_data.get("goal_update_required"))
    return not (goal and not goal_update_required)


class TelegramAuthRequest(BaseModel):
    init_data: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    onboarding_done: bool
    profile_photo_url: str | None = None
    photo_dark_url: str | None = None
    photo_light_url: str | None = None
    primary_role: str | None = None
    has_player_access: bool = False
    has_responsible_access: bool = False
    is_admin: bool = False
    has_promo_code: bool = False
    ban_until: str | None = None
    ban_reason: str | None = None
    ban_missed: int = 0
    # Subscription v2 fields
    own_access_tier: str | None = None
    player_view_tier: str | None = None
    shop_freeze_balance: int = 0
    gift_freeze_balance: int = 0
    streak_freeze_balance: int = 0
    rest_days_remaining: int = 0
    has_active_partnerships: bool = False
    days_left: int | None = None
    unread_notifications: int = 0
    gender: str | None = None
    onboarding_blocked: bool = False
    onboarding_blocked_message: str | None = None


async def _build_full_token_response(db, telegram_id: int, user_data: dict) -> TokenResponse:
    user_uuid = user_data["id"]
    primary = user_data.get("primary_role")
    is_admin = bool(user_data.get("is_admin", False))
    compat_role = "admin" if is_admin else (primary or user_data.get("role") or SHELL_ROLE)

    raw_done = user_data.get("onboarding_done", False)
    effective_done = True if (is_admin or compat_role in ("responsible", "admin")) else raw_done

    has_player_access = bool(user_data.get("has_player_access", False))
    has_responsible_access = bool(user_data.get("has_responsible_access", False))

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # has_promo_code — unused player_code for responsibles
    has_promo = False
    promo_res = (
        await db.table("promo_codes")
        .select("id")
        .eq("responsible_id", user_uuid)
        .eq("code_type", "player")
        .eq("is_used", False)
        .limit(1)
        .execute()
    )
    has_promo = bool(promo_res.data)

    # Active ban
    ban_until_raw = user_data.get("ban_until")
    active_ban_until: str | None = None
    if ban_until_raw:
        try:
            ban_dt = datetime.fromisoformat(ban_until_raw)
            if ban_dt.tzinfo is None:
                ban_dt = ban_dt.replace(tzinfo=timezone.utc)
            if ban_dt > now:
                active_ban_until = ban_until_raw
        except Exception:
            pass

    # own_access_tier — tier for the user's primary capability
    own_access_tier: str | None = None
    if is_admin or has_responsible_access:
        own_access_tier = user_data.get("responsible_access_tier")
    elif has_player_access:
        own_access_tier = user_data.get("player_access_tier")

    # player_view_tier — inherited tier from Responsible (stored at P-code activation)
    player_view_tier: str | None = None
    days_left: int | None = None
    if has_player_access:
        player_view_tier = user_data.get("player_access_tier")

        part_res = (
            await db.table("partnerships")
            .select("expires_at")
            .eq("player_id", user_uuid)
            .order("expires_at", desc=True)
            .limit(1)
            .execute()
        )
        part_row = (part_res.data or [None])[0]
        if part_row:
            expires_at_raw = part_row.get("expires_at")
            if expires_at_raw:
                try:
                    exp_dt = datetime.fromisoformat(expires_at_raw)
                    if exp_dt.tzinfo is None:
                        exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                    if exp_dt > now:
                        delta = exp_dt - now
                        days_left = max(1, math.ceil(delta.total_seconds() / 86400))
                except Exception:
                    pass

    # Freeze wallets (Responsible) — from user_data
    shop_freeze_balance = int(user_data.get("shop_freeze_balance") or 0)
    gift_freeze_balance = int(user_data.get("gift_freeze_balance") or 0)

    # Player stats — streak freeze + rest days
    streak_freeze_balance = 0
    rest_days_remaining = 0
    if has_player_access:
        ps_res = (
            await db.table("player_stats")
            .select("streak_freeze_balance, rest_days_remaining")
            .eq("player_id", user_uuid)
            .maybe_single()
            .execute()
        )
        if ps_res is not None and ps_res.data:
            streak_freeze_balance = int(ps_res.data.get("streak_freeze_balance") or 0)
            rest_days_remaining = int(ps_res.data.get("rest_days_remaining") or 0)

    # has_active_partnerships — Responsible/Admin
    has_active_partnerships = False
    if is_admin or has_responsible_access:
        ap_res = (
            await db.table("partnerships")
            .select("id", count="exact")
            .eq("responsible_id", user_uuid)
            .gt("expires_at", now_iso)
            .execute()
        )
        has_active_partnerships = bool((ap_res.count or 0) > 0)

    # unread notifications
    un_res = (
        await db.table("notifications")
        .select("id", count="exact")
        .eq("user_id", user_uuid)
        .is_("read_at", "null")
        .execute()
    )
    unread_notifications = int(un_res.count or 0)

    token = create_access_token(telegram_id, compat_role)
    blocked = _is_onboarding_blocked(user_data)

    return TokenResponse(
        access_token=token,
        role=compat_role,
        onboarding_done=effective_done,
        profile_photo_url=user_data.get("profile_photo_url"),
        photo_dark_url=user_data.get("photo_dark_url"),
        photo_light_url=user_data.get("photo_light_url"),
        primary_role=primary,
        has_player_access=has_player_access,
        has_responsible_access=has_responsible_access,
        is_admin=is_admin,
        has_promo_code=has_promo,
        ban_until=active_ban_until,
        ban_reason=user_data.get("ban_reason") if active_ban_until else None,
        ban_missed=user_data.get("ban_missed_workouts", 0) if active_ban_until else 0,
        own_access_tier=own_access_tier,
        player_view_tier=player_view_tier,
        shop_freeze_balance=shop_freeze_balance,
        gift_freeze_balance=gift_freeze_balance,
        streak_freeze_balance=streak_freeze_balance,
        rest_days_remaining=rest_days_remaining,
        has_active_partnerships=has_active_partnerships,
        days_left=days_left,
        unread_notifications=unread_notifications,
        gender=user_data.get("gender"),
        onboarding_blocked=blocked,
        onboarding_blocked_message=ONBOARDING_REQUIRED_MESSAGE if blocked else None,
    )


@router.post("/telegram", response_model=TokenResponse)
async def telegram_auth(body: TelegramAuthRequest) -> TokenResponse:
    """
    1. Валидируем initData (HMAC-SHA256)
    2. SELECT пользователя — 403 NO_ACCESS если не найден
    3. Возвращаем JWT + профиль v2
    """
    parsed = validate_init_data(body.init_data)
    tg_user = parsed.get("user")
    if not tg_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user in initData")

    telegram_id: int = tg_user["id"]
    db = await get_supabase()

    user_res = (
        await db.table("users")
        .select(USER_SELECT_COLS)
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    user_data = user_res.data if user_res is not None else None
    if user_data is None:
        raise HTTPException(status_code=403, detail={"code": "NO_ACCESS"})

    return await _build_full_token_response(db, telegram_id, user_data)


@router.post("/register", response_model=TokenResponse)
async def register_user(body: TelegramAuthRequest) -> TokenResponse:
    """
    Endpoint для первичной регистрации через мини-апп.
    Если пользователь уже существует — возвращает его данные (как /telegram).
    Если нет — создаёт минимальную запись с role='new', onboarding_done=False.
    """
    parsed = validate_init_data(body.init_data)
    tg_user = parsed.get("user")
    if not tg_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user in initData")

    telegram_id: int = tg_user["id"]
    db = await get_supabase()

    user_res = (
        await db.table("users")
        .select(USER_SELECT_COLS)
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    user_data = user_res.data if user_res is not None else None

    # Уже зарегистрирован — возвращаем профиль v2
    if user_data is not None:
        _check_onboarding_gate(user_data)
        return await _build_full_token_response(db, telegram_id, user_data)

    # Новый пользователь — создаём минимальную запись
    await (
        db.table("users")
        .insert({
            "telegram_id": telegram_id,
            "first_name": tg_user.get("first_name", ""),
            "telegram_username": tg_user.get("username"),
            "onboarding_done": False,
            "has_player_access": False,
            "has_responsible_access": False,
            "is_admin": False,
        })
        .execute()
    )

    fresh_res = (
        await db.table("users")
        .select(USER_SELECT_COLS)
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    fresh_data = fresh_res.data if fresh_res is not None else None
    if fresh_data is not None:
        return await _build_full_token_response(db, telegram_id, fresh_data)

    # Fallback: запись не прочиталась — минимальный ответ с дефолтами
    token = create_access_token(telegram_id, SHELL_ROLE)
    return TokenResponse(
        access_token=token,
        role=SHELL_ROLE,
        onboarding_done=False,
        has_player_access=False,
        has_responsible_access=False,
        is_admin=False,
    )

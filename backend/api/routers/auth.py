"""POST /auth/telegram — валидирует initData, возвращает JWT."""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ...core.security import create_access_token, validate_init_data
from ...db.client import get_supabase

router = APIRouter(prefix="/auth", tags=["auth"])

SHELL_ROLE = "new"  # временная роль для незарегистрированных пользователей


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
    # Dual-role fields (migration 007)
    primary_role: str | None = None
    has_player_access: bool = False
    has_responsible_access: bool = False
    is_admin: bool = False
    # Promo v2: has unused player_code (for responsibles)
    has_promo_code: bool = False
    # Ban info — set if user is currently banned (lets frontend show BanScreen without waiting for 403)
    ban_until: str | None = None
    ban_reason: str | None = None
    ban_missed: int = 0


@router.post("/telegram", response_model=TokenResponse)
async def telegram_auth(body: TelegramAuthRequest) -> TokenResponse:
    """
    1. Валидируем initData (HMAC-SHA256)
    2. SELECT пользователя — 403 NO_ACCESS если не найден
    3. Возвращаем JWT
    """
    parsed = validate_init_data(body.init_data)
    tg_user = parsed.get("user")
    if not tg_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user in initData")

    telegram_id: int = tg_user["id"]
    db = await get_supabase()

    # SELECT only — no upsert. User must exist (created by bot after promo activation).
    user_res = (
        await db.table("users")
        .select("id, role, onboarding_done, profile_photo_url, photo_dark_url, photo_light_url, primary_role, has_player_access, has_responsible_access, is_admin, ban_until, ban_reason, ban_missed_workouts")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    user_data = user_res.data if user_res is not None else None
    if user_data is None:
        raise HTTPException(status_code=403, detail={"code": "NO_ACCESS"})
    user_uuid = user_data.get("id")

    # Backward-compat: compute `role` from dual-role fields
    primary = user_data.get("primary_role")
    is_admin = user_data.get("is_admin", False)
    compat_role = "admin" if is_admin else (primary or user_data.get("role"))

    # Admin/Responsible skip promo onboarding — force onboarding_done=True
    raw_onboarding_done = user_data.get("onboarding_done", False)
    effective_onboarding_done = (
        True if (is_admin or compat_role in ("responsible", "admin")) else raw_onboarding_done
    )

    # Check for unused player_code (for responsibles)
    has_promo = False
    if user_uuid:
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

    token = create_access_token(telegram_id, compat_role)

    # Compute active ban info (only if ban_until is in the future)
    ban_until_raw = user_data.get("ban_until")
    active_ban_until: str | None = None
    if ban_until_raw:
        try:
            ban_dt = datetime.fromisoformat(ban_until_raw)
            if ban_dt.tzinfo is None:
                ban_dt = ban_dt.replace(tzinfo=timezone.utc)
            if ban_dt > datetime.now(timezone.utc):
                active_ban_until = ban_until_raw
        except Exception:
            pass

    return TokenResponse(
        access_token=token,
        role=compat_role,
        onboarding_done=effective_onboarding_done,
        profile_photo_url=user_data.get("profile_photo_url"),
        photo_dark_url=user_data.get("photo_dark_url"),
        photo_light_url=user_data.get("photo_light_url"),
        primary_role=primary,
        has_player_access=user_data.get("has_player_access", False),
        has_responsible_access=user_data.get("has_responsible_access", False),
        is_admin=is_admin,
        has_promo_code=has_promo,
        ban_until=active_ban_until,
        ban_reason=user_data.get("ban_reason") if active_ban_until else None,
        ban_missed=user_data.get("ban_missed_workouts", 0) if active_ban_until else 0,
    )


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
        .select("id, role, onboarding_done, profile_photo_url, photo_dark_url, photo_light_url, primary_role, has_player_access, has_responsible_access, is_admin")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    user_data = user_res.data if user_res is not None else None

    # Уже зарегистрирован — возвращаем как /telegram
    if user_data is not None:
        primary = user_data.get("primary_role")
        is_admin = user_data.get("is_admin", False)
        compat_role = "admin" if is_admin else (primary or user_data.get("role") or SHELL_ROLE)
        raw_done = user_data.get("onboarding_done", False)
        effective_done = True if (is_admin or compat_role in ("responsible", "admin")) else raw_done
        token = create_access_token(telegram_id, compat_role)
        return TokenResponse(
            access_token=token,
            role=compat_role,
            onboarding_done=effective_done,
            profile_photo_url=user_data.get("profile_photo_url"),
            photo_dark_url=user_data.get("photo_dark_url"),
            photo_light_url=user_data.get("photo_light_url"),
            primary_role=primary,
            has_player_access=user_data.get("has_player_access", False),
            has_responsible_access=user_data.get("has_responsible_access", False),
            is_admin=is_admin,
        )

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

    token = create_access_token(telegram_id, SHELL_ROLE)
    return TokenResponse(
        access_token=token,
        role=SHELL_ROLE,
        onboarding_done=False,
        has_player_access=False,
        has_responsible_access=False,
        is_admin=False,
    )

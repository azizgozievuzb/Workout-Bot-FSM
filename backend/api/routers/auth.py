"""POST /auth/telegram — валидирует initData, возвращает JWT."""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ...core.security import create_access_token, validate_init_data
from ...db.client import get_supabase

router = APIRouter(prefix="/auth", tags=["auth"])


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


@router.post("/telegram", response_model=TokenResponse)
async def telegram_auth(body: TelegramAuthRequest) -> TokenResponse:
    """
    1. Валидируем initData (HMAC-SHA256)
    2. Upsert пользователя в БД
    3. Возвращаем JWT
    """
    parsed = validate_init_data(body.init_data)
    tg_user = parsed.get("user")
    if not tg_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user in initData")

    telegram_id: int = tg_user["id"]
    db = await get_supabase()

    # Upsert — создаём если нет, не трогаем если есть
    await (
        db.table("users")
        .upsert(
            {
                "telegram_id": telegram_id,
                "telegram_username": tg_user.get("username"),
                "first_name": tg_user.get("first_name"),
            },
            on_conflict="telegram_id",
            ignore_duplicates=True,
        )
        .execute()
    )

    # Получаем актуальные данные
    user_res = (
        await db.table("users")
        .select("role, onboarding_done, profile_photo_url, photo_dark_url, photo_light_url")
        .eq("telegram_id", telegram_id)
        .single()
        .execute()
    )
    user_data = user_res.data

    token = create_access_token(telegram_id, user_data["role"])

    return TokenResponse(
        access_token=token,
        role=user_data["role"],
        onboarding_done=user_data.get("onboarding_done", False),
        profile_photo_url=user_data.get("profile_photo_url"),
        photo_dark_url=user_data.get("photo_dark_url"),
        photo_light_url=user_data.get("photo_light_url"),
    )

"""GET /users/me — профиль текущего пользователя."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/users", tags=["users"])


class UserProfile(BaseModel):
    telegram_id: int
    telegram_username: str | None
    first_name: str | None
    role: str
    gender: str | None
    lang: str
    profile_photo_url: str | None
    onboarding_state: str
    onboarding_done: bool


@router.get("/me", response_model=UserProfile)
async def get_me(current_user: dict = Depends(get_current_user)) -> UserProfile:
    db = await get_supabase()
    result = (
        await db.table("users")
        .select("*")
        .eq("telegram_id", current_user["telegram_id"])
        .single()
        .execute()
    )
    return UserProfile(**result.data)

"""Users API — профиль + загрузка фото."""
import base64
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
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


class PhotoUpload(BaseModel):
    """Base64-encoded JPEG photo."""
    photo_base64: str  # data:image/jpeg;base64,... or raw base64


class PhotoResponse(BaseModel):
    profile_photo_url: str


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


@router.post("/me/photo", response_model=PhotoResponse)
async def upload_photo(
    body: PhotoUpload,
    current_user: dict = Depends(get_current_user),
) -> PhotoResponse:
    """Upload selfie → Supabase Storage → save URL in users table."""
    db = await get_supabase()
    tid = current_user["telegram_id"]

    # Strip data URI prefix if present
    raw = body.photo_base64
    if "," in raw:
        raw = raw.split(",", 1)[1]

    try:
        photo_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid base64")

    if len(photo_bytes) > 5 * 1024 * 1024:  # 5 MB limit
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Photo too large (max 5MB)")

    # Upload to Supabase Storage (bucket: avatars)
    file_name = f"{tid}/{uuid.uuid4().hex}.jpg"
    try:
        await db.storage.from_("avatars").upload(
            file_name,
            photo_bytes,
            {"content-type": "image/jpeg", "upsert": "true"},
        )
    except Exception as e:
        # If file exists, remove and retry
        if "Duplicate" in str(e) or "already exists" in str(e):
            await db.storage.from_("avatars").remove([file_name])
            await db.storage.from_("avatars").upload(
                file_name,
                photo_bytes,
                {"content-type": "image/jpeg"},
            )
        else:
            raise HTTPException(status_code=500, detail=f"Storage error: {e}")

    # Get public URL
    public_url = db.storage.from_("avatars").get_public_url(file_name)

    # Update user record
    await (
        db.table("users")
        .update({"profile_photo_url": public_url})
        .eq("telegram_id", tid)
        .execute()
    )

    return PhotoResponse(profile_photo_url=public_url)

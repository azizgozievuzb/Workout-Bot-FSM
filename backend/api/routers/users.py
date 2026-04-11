"""Users API — профиль + загрузка фото."""
import base64
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

logger = logging.getLogger(__name__)

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
    photo_base64: str


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

    if len(photo_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Photo too large (max 5MB)")

    file_name = f"{tid}/{uuid.uuid4().hex}.jpg"

    # Upload to Supabase Storage (bucket: avatars)
    try:
        # First, try to remove old photos for this user
        try:
            existing = await db.storage.from_("avatars").list(str(tid))
            if existing:
                old_files = [f"{tid}/{f['name']}" for f in existing]
                if old_files:
                    await db.storage.from_("avatars").remove(old_files)
        except Exception:
            pass  # No old files or folder doesn't exist yet

        # Upload new photo
        await db.storage.from_("avatars").upload(
            path=file_name,
            file=photo_bytes,
            file_options={"content-type": "image/jpeg", "x-upsert": "true"},
        )
    except Exception as e:
        logger.error(f"Storage upload failed for user {tid}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Storage upload failed: {str(e)[:200]}",
        )

    # Build public URL directly (get_public_url may be sync or async depending on client)
    from ...core.config import settings
    base = settings.SUPABASE_URL.strip().strip("'").strip('"').rstrip("/")
    public_url = f"{base}/storage/v1/object/public/avatars/{file_name}"

    # Update user record
    try:
        await (
            db.table("users")
            .update({"profile_photo_url": public_url})
            .eq("telegram_id", tid)
            .execute()
        )
    except Exception as e:
        logger.error(f"DB update failed for user {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"DB update failed: {e}")

    return PhotoResponse(profile_photo_url=public_url)

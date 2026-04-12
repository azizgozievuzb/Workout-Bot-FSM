"""Activity Feed API — Bond cube (migration 009)."""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/feed", tags=["activity_feed"])


class FeedItem(BaseModel):
    id: str
    source_user_id: str
    event_type: str
    payload: dict
    is_read: bool
    created_at: str


class FeedResponse(BaseModel):
    items: list[FeedItem]
    total: int


class UnreadCountResponse(BaseModel):
    count: int


class MarkReadRequest(BaseModel):
    ids: list[str]


class MarkReadResponse(BaseModel):
    updated: int


@router.get("", response_model=FeedResponse)
async def get_feed(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()

    # Get user UUID from telegram_id
    user_res = (
        await db.table("users")
        .select("id")
        .eq("telegram_id", user["telegram_id"])
        .single()
        .execute()
    )
    user_id = user_res.data["id"]

    # Fetch feed items
    result = (
        await db.table("activity_feed")
        .select("id, source_user_id, event_type, payload, is_read, created_at", count="exact")
        .eq("target_user_id", user_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    return FeedResponse(
        items=[FeedItem(**row) for row in (result.data or [])],
        total=result.count or 0,
    )


@router.post("/read", response_model=MarkReadResponse)
async def mark_read(
    body: MarkReadRequest,
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()

    user_res = (
        await db.table("users")
        .select("id")
        .eq("telegram_id", user["telegram_id"])
        .single()
        .execute()
    )
    user_id = user_res.data["id"]

    result = (
        await db.table("activity_feed")
        .update({"is_read": True})
        .eq("target_user_id", user_id)
        .in_("id", body.ids)
        .execute()
    )

    return MarkReadResponse(updated=len(result.data or []))


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(
    user: dict = Depends(get_current_user),
):
    db = await get_supabase()

    user_res = (
        await db.table("users")
        .select("id")
        .eq("telegram_id", user["telegram_id"])
        .single()
        .execute()
    )
    user_id = user_res.data["id"]

    result = (
        await db.table("activity_feed")
        .select("id", count="exact")
        .eq("target_user_id", user_id)
        .eq("is_read", False)
        .execute()
    )

    return UnreadCountResponse(count=result.count or 0)

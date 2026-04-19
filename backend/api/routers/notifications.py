"""Notification Center — REST API."""
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class NotificationItem(BaseModel):
    id: str
    type: str
    title: str
    message: str
    payload: dict[str, Any]
    read_at: str | None
    created_at: str


class NotificationListResp(BaseModel):
    items: list[NotificationItem]
    unread_count: int


class UnreadCountResp(BaseModel):
    count: int


class ReadAllResp(BaseModel):
    updated: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _fetch_user_id(db, telegram_id: int) -> str:
    res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    return res.data["id"]


def _map_row(row: dict) -> NotificationItem:
    return NotificationItem(
        id=str(row["id"]),
        type=row.get("type") or "",
        title=row.get("title") or "",
        message=row.get("message") or "",
        payload=row.get("payload") or {},
        read_at=row.get("read_at"),
        created_at=row.get("created_at"),
    )


# ---------------------------------------------------------------------------
# GET /notifications
# ---------------------------------------------------------------------------

@router.get("", response_model=NotificationListResp)
async def list_notifications(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
) -> NotificationListResp:
    db = await get_supabase()
    me_id = await _fetch_user_id(db, current_user["telegram_id"])

    list_res = await (
        db.table("notifications")
        .select("id, type, title, message, payload, read_at, created_at")
        .eq("user_id", me_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    items = [_map_row(r) for r in (list_res.data or [])]

    unread_res = await (
        db.table("notifications")
        .select("id", count="exact")
        .eq("user_id", me_id)
        .is_("read_at", "null")
        .execute()
    )
    unread_count = unread_res.count or 0

    return NotificationListResp(items=items, unread_count=unread_count)


# ---------------------------------------------------------------------------
# GET /notifications/unread-count
# ---------------------------------------------------------------------------

@router.get("/unread-count", response_model=UnreadCountResp)
async def unread_count(current_user: dict = Depends(get_current_user)) -> UnreadCountResp:
    db = await get_supabase()
    me_id = await _fetch_user_id(db, current_user["telegram_id"])

    res = await (
        db.table("notifications")
        .select("id", count="exact")
        .eq("user_id", me_id)
        .is_("read_at", "null")
        .execute()
    )
    return UnreadCountResp(count=res.count or 0)


# ---------------------------------------------------------------------------
# POST /notifications/{id}/read
# ---------------------------------------------------------------------------

@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
) -> dict:
    db = await get_supabase()
    me_id = await _fetch_user_id(db, current_user["telegram_id"])
    id_str = str(notification_id)

    exists_res = await (
        db.table("notifications")
        .select("id, read_at")
        .eq("id", id_str)
        .eq("user_id", me_id)
        .maybe_single()
        .execute()
    )
    if not exists_res or not exists_res.data:
        raise HTTPException(status_code=404, detail="Notification not found")

    if exists_res.data.get("read_at"):
        return {"ok": True}

    now_iso = datetime.now(timezone.utc).isoformat()
    await (
        db.table("notifications")
        .update({"read_at": now_iso})
        .eq("id", id_str)
        .eq("user_id", me_id)
        .is_("read_at", "null")
        .execute()
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# POST /notifications/read-all
# ---------------------------------------------------------------------------

@router.post("/read-all", response_model=ReadAllResp)
async def mark_all_read(current_user: dict = Depends(get_current_user)) -> ReadAllResp:
    db = await get_supabase()
    me_id = await _fetch_user_id(db, current_user["telegram_id"])

    now_iso = datetime.now(timezone.utc).isoformat()
    upd_res = await (
        db.table("notifications")
        .update({"read_at": now_iso})
        .eq("user_id", me_id)
        .is_("read_at", "null")
        .execute()
    )
    updated = len(upd_res.data or [])
    return ReadAllResp(updated=updated)

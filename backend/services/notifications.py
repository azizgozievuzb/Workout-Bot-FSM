"""Notification bus — единая точка создания уведомлений."""
import logging
from typing import Any

from supabase import AsyncClient

logger = logging.getLogger(__name__)


async def emit_notification(
    db: AsyncClient,
    *,
    user_id: str,
    type: str,
    title: str,
    message: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """Fire-and-forget INSERT. Никогда не бросает наружу — логирует и глотает."""
    try:
        await (
            db.table("notifications")
            .insert({
                "user_id": user_id,
                "type": type,
                "title": title,
                "message": message or "",
                "payload": payload or {},
            })
            .execute()
        )
    except Exception as e:
        logger.warning("emit_notification failed: %s", e)

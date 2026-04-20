"""
APScheduler jobs for promo code TTL lifecycle.

Job A (every 10 min) — expire_codes:
  Moves expired player codes to archive, deactivates users.

Job B (every hour)   — warn_expiring:
  Sends Telegram warning 24h before expiry.

Job C (daily)        — hard_delete_inactive:
  Cascade-deletes users whose 30-day grace period has elapsed.
"""
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from ..db.client import get_supabase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Job A — expire_codes (every 10 minutes)
# ---------------------------------------------------------------------------

async def expire_codes() -> None:
    """Archive expired player promo codes and deactivate their users."""
    db = await get_supabase()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    deletion_at = (now + timedelta(days=30)).isoformat()

    res = await (
        db.table("promo_codes")
        .select("*")
        .eq("code_type", "player")
        .lt("expires_at", now_iso)
        .not_.is_("expires_at", "null")
        .execute()
    )

    if not res.data:
        return

    logger.info("[promo_lifecycle] expire_codes: found %d expired codes", len(res.data))

    for row in res.data:
        try:
            partnership_id = None
            responsible_id_int = None
            player_id_int = row.get("activated_by")

            # Resolve partnership metadata via activated_by (telegram_id)
            if player_id_int:
                user_res = await (
                    db.table("users")
                    .select("id")
                    .eq("telegram_id", player_id_int)
                    .maybe_single()
                    .execute()
                )
                if user_res and user_res.data:
                    player_uuid = user_res.data["id"]
                    pair_res = await (
                        db.table("partnerships")
                        .select("id, responsible_id")
                        .eq("player_id", player_uuid)
                        .eq("status", "active")
                        .maybe_single()
                        .execute()
                    )
                    if pair_res and pair_res.data:
                        partnership_id = pair_res.data["id"]
                        resp_res = await (
                            db.table("users")
                            .select("telegram_id")
                            .eq("id", pair_res.data["responsible_id"])
                            .maybe_single()
                            .execute()
                        )
                        if resp_res and resp_res.data:
                            responsible_id_int = resp_res.data["telegram_id"]

            # Insert into archive
            await (
                db.table("promo_codes_archive")
                .insert({
                    "original_id": row["id"],
                    "code": row["code"],
                    "code_type": row.get("code_type"),
                    "duration_days": row.get("duration_days"),
                    "created_at": row.get("created_at"),
                    "created_by": None,
                    "activated_at": row.get("activated_at"),
                    "activated_by": row.get("activated_by"),
                    "partnership_id": str(partnership_id) if partnership_id else None,
                    "responsible_id": responsible_id_int,
                    "player_id": player_id_int,
                    "expired_at": now_iso,
                })
                .execute()
            )

            # Delete from live table
            await (
                db.table("promo_codes")
                .delete()
                .eq("id", row["id"])
                .execute()
            )

            # Deactivate the player
            if player_id_int:
                await (
                    db.table("users")
                    .update({
                        "deactivated_at": now_iso,
                        "scheduled_deletion_at": deletion_at,
                    })
                    .eq("telegram_id", player_id_int)
                    .is_("deactivated_at", "null")  # only if not already deactivated
                    .execute()
                )

            logger.info("[promo_lifecycle] archived code %s (player tg=%s)", row["id"], player_id_int)

        except Exception as e:
            logger.error("[promo_lifecycle] expire_codes failed for %s: %s", row.get("id"), e)


# ---------------------------------------------------------------------------
# Job B — warn_expiring (every hour)
# ---------------------------------------------------------------------------

async def warn_expiring(bot) -> None:
    """Send 24h expiry warning to players. Requires bot instance."""
    if bot is None:
        logger.warning("[promo_lifecycle] warn_expiring skipped: bot is None")
        return
    db = await get_supabase()
    now = datetime.now(timezone.utc)
    window_start = (now + timedelta(hours=23)).isoformat()
    window_end = (now + timedelta(hours=25)).isoformat()

    res = await (
        db.table("promo_codes")
        .select("id, activated_by, expires_at")
        .eq("code_type", "player")
        .gte("expires_at", window_start)
        .lte("expires_at", window_end)
        .is_("warn_sent", "null")
        .execute()
    )

    if not res.data:
        return

    logger.info("[promo_lifecycle] warn_expiring: %d codes to warn", len(res.data))

    for row in res.data:
        tg_id = row.get("activated_by")
        if not tg_id:
            continue
        try:
            await bot.send_message(
                chat_id=tg_id,
                text=(
                    "⚠️ <b>Ваш доступ истекает завтра.</b>\n\n"
                    "Прогресс будет храниться 1 месяц, затем удалится автоматически.\n"
                    "Свяжитесь с Ответственным для продления."
                ),
                parse_mode="HTML",
            )
            await (
                db.table("promo_codes")
                .update({"warn_sent": now.isoformat()})
                .eq("id", row["id"])
                .execute()
            )
        except Exception as e:
            logger.error("[promo_lifecycle] warn_expiring failed for tg=%s: %s", tg_id, e)


# ---------------------------------------------------------------------------
# Job C — hard_delete_inactive (daily)
# ---------------------------------------------------------------------------

async def hard_delete_inactive() -> None:
    """Cascade-delete users whose 30-day grace period has elapsed."""
    db = await get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    res = await (
        db.table("users")
        .select("id, telegram_id")
        .lt("scheduled_deletion_at", now_iso)
        .not_.is_("deactivated_at", "null")  # still deactivated (not reactivated)
        .execute()
    )

    if not res.data:
        return

    logger.info("[promo_lifecycle] hard_delete_inactive: %d users to delete", len(res.data))

    for user in res.data:
        uid = user["id"]
        tg_id = user["telegram_id"]
        try:
            # Cascade delete in dependency order
            await db.table("player_stats").delete().eq("player_id", uid).execute()
            await db.table("purchases").delete().eq("player_id", uid).execute()
            await db.table("boosts").delete().eq("player_id", uid).execute()
            await db.table("activity_feed").delete().eq("player_id", uid).execute()
            await db.table("partnerships").delete().eq("player_id", uid).execute()
            await db.table("users").delete().eq("id", uid).execute()
            logger.info("[promo_lifecycle] hard_deleted user id=%s tg=%s", uid, tg_id)
        except Exception as e:
            logger.error("[promo_lifecycle] hard_delete failed for id=%s: %s", uid, e)


# ---------------------------------------------------------------------------
# Scheduler factory
# ---------------------------------------------------------------------------

def create_scheduler(bot) -> AsyncIOScheduler:
    """Create and configure the APScheduler instance."""
    scheduler = AsyncIOScheduler(timezone="UTC")

    scheduler.add_job(
        expire_codes,
        trigger="interval",
        minutes=10,
        id="expire_codes",
        replace_existing=True,
    )

    scheduler.add_job(
        warn_expiring,
        trigger="interval",
        hours=1,
        id="warn_expiring",
        replace_existing=True,
        kwargs={"bot": bot},
    )

    scheduler.add_job(
        hard_delete_inactive,
        trigger="cron",
        hour=3,
        minute=0,
        id="hard_delete_inactive",
        replace_existing=True,
    )

    from .subscription_lifecycle import register_subscription_jobs
    register_subscription_jobs(scheduler)

    return scheduler

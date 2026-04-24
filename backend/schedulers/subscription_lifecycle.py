"""
Jobs E/F/G/H — subscription & streak lifecycle (v2, partnership-based).

Job E (daily 00:10 UTC) — consume_streak_freezes:
  Для каждого Player у которого current_streak > 0, last_workout_date < yesterday,
  last_rest_day_date != yesterday:
    - streak_freeze_balance > 0 → -= 1, emit 'freeze_consumed'
    - иначе current_streak = 0, emit 'streak_broken'

Job F (daily 03:15 UTC) — purge_old_workout_data:
  Hard-delete workout_sessions + workout_exercises для player_id из партнёрств,
  где expires_at < now() - 90 days.

Job G (daily 03:30 UTC) — cleanup_dead_partnerships:
  Hard-delete partnerships WHERE expires_at < now() - 90 days.
  Cascade через FK снесёт связанные рядов (Player user row если это было его единственное партнёрство).

Job H (daily 03:00 UTC) — increment_active_days:
  Для каждого player с активной подпиской (partnerships.expires_at > now()):
    - active_days_count += 1
    - если active_days_count % 120 == 0 → goal_update_required = TRUE + bot push с просьбой
      обновить цель через /settings.
"""
import logging
from datetime import datetime, timedelta, timezone, date

from ..db.client import get_supabase
from ..services.notifications import emit_notification
from ..services.bot_notify import send_bot_message

logger = logging.getLogger(__name__)


async def consume_streak_freezes() -> None:
    db = await get_supabase()
    today = date.today()
    yesterday = today - timedelta(days=1)
    yesterday_iso = yesterday.isoformat()

    res = await (
        db.table("player_stats")
        .select("player_id, current_streak, streak_freeze_balance, last_workout_date, last_rest_day_date")
        .gt("current_streak", 0)
        .execute()
    )
    if not res.data:
        return

    logger.info("[sub_lifecycle] Job E: checking %d players", len(res.data))

    for row in res.data:
        pid = row["player_id"]
        streak = int(row.get("current_streak") or 0)
        freeze = int(row.get("streak_freeze_balance") or 0)
        lwd = row.get("last_workout_date")
        lrd = row.get("last_rest_day_date")

        if lwd and lwd >= yesterday_iso:
            continue
        if lrd == yesterday_iso:
            continue

        try:
            if freeze > 0:
                upd = await (
                    db.table("player_stats")
                    .update({"streak_freeze_balance": freeze - 1})
                    .eq("player_id", pid)
                    .eq("streak_freeze_balance", freeze)
                    .execute()
                )
                if upd.data:
                    await emit_notification(
                        db, user_id=pid, type="freeze_consumed",
                        title="❄️ Заморозка сработала",
                        message=f"Стрик сохранён. Осталось заморозок: {freeze - 1}",
                        payload={"new_balance": freeze - 1, "streak": streak},
                    )
                    logger.info("[sub_lifecycle] freeze consumed pid=%s", pid)
            else:
                upd = await (
                    db.table("player_stats")
                    .update({"current_streak": 0})
                    .eq("player_id", pid)
                    .eq("current_streak", streak)
                    .execute()
                )
                if upd.data:
                    await emit_notification(
                        db, user_id=pid, type="streak_broken",
                        title="💔 Стрик прерван",
                        message=f"Ты пропустил день. Было: {streak}. Не сдавайся — начни заново.",
                        payload={"prev_streak": streak},
                    )
                    logger.info("[sub_lifecycle] streak broken pid=%s prev=%d", pid, streak)
        except Exception as e:
            logger.error("[sub_lifecycle] Job E failed for pid=%s: %s", pid, e)


async def purge_old_workout_data() -> None:
    db = await get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()

    parts = await (
        db.table("partnerships")
        .select("player_id")
        .lt("expires_at", cutoff)
        .execute()
    )
    if not parts.data:
        return

    player_ids = list({p["player_id"] for p in parts.data if p.get("player_id")})
    if not player_ids:
        return

    logger.info("[sub_lifecycle] Job F: purging workout data for %d players", len(player_ids))

    try:
        await db.table("workout_exercises").delete().in_("player_id", player_ids).execute()
    except Exception as e:
        logger.error("[sub_lifecycle] Job F workout_exercises delete failed: %s", e)

    try:
        await db.table("workout_sessions").delete().in_("player_id", player_ids).execute()
    except Exception as e:
        logger.error("[sub_lifecycle] Job F workout_sessions delete failed: %s", e)


async def cleanup_dead_partnerships() -> None:
    db = await get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()

    res = await (
        db.table("partnerships")
        .select("id")
        .lt("expires_at", cutoff)
        .execute()
    )
    if not res.data:
        return

    logger.info("[sub_lifecycle] Job G: deleting %d dead partnerships", len(res.data))

    ids = [r["id"] for r in res.data]
    try:
        await db.table("partnerships").delete().in_("id", ids).execute()
    except Exception as e:
        logger.error("[sub_lifecycle] Job G delete failed: %s", e)


async def increment_active_days() -> None:
    """Job H — daily 03:00 UTC.

    Для каждого уникального player с активной партнёркой (expires_at > now()):
      users.active_days_count += 1
      если new_count % 120 == 0 → users.goal_update_required = TRUE + bot push.

    Push шлём best-effort: если bot ещё не инициализирован (get_bot → RuntimeError)
    — логируем и продолжаем.
    """
    db = await get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    parts = await (
        db.table("partnerships")
        .select("player_id")
        .gt("expires_at", now_iso)
        .execute()
    )
    if not parts.data:
        return

    player_ids = list({p["player_id"] for p in parts.data if p.get("player_id")})
    if not player_ids:
        return

    logger.info("[sub_lifecycle] Job H: incrementing active_days for %d players", len(player_ids))

    # Fetch current counts + tg ids one query
    users_res = await (
        db.table("users")
        .select("id, telegram_id, role, active_days_count")
        .in_("id", player_ids)
        .eq("role", "player")
        .execute()
    )
    if not users_res.data:
        return

    bot = None
    try:
        from ..core.deps import get_bot
        bot = get_bot()
    except Exception as e:
        logger.info("[sub_lifecycle] Job H: bot not available (%s) — skipping push", e)

    for row in users_res.data:
        pid = row["id"]
        tg_id = row.get("telegram_id")
        prev = int(row.get("active_days_count") or 0)
        new_count = prev + 1

        update = {"active_days_count": new_count}
        trigger_goal_refresh = new_count > 0 and new_count % 120 == 0
        if trigger_goal_refresh:
            update["goal_update_required"] = True

        try:
            await (
                db.table("users")
                .update(update)
                .eq("id", pid)
                .execute()
            )
        except Exception as e:
            logger.error("[sub_lifecycle] Job H update failed pid=%s: %s", pid, e)
            continue

        if trigger_goal_refresh and tg_id and bot is not None:
            await send_bot_message(
                bot,
                tg_id,
                f"🎯 Прошло {new_count} активных дней — обнови цель: /settings",
            )


def register_subscription_jobs(scheduler) -> None:
    """Вызывается из promo_lifecycle.create_scheduler (или main lifespan)."""
    scheduler.add_job(
        consume_streak_freezes,
        trigger="cron", hour=0, minute=10,
        id="consume_streak_freezes", replace_existing=True,
    )
    scheduler.add_job(
        increment_active_days,
        trigger="cron", hour=3, minute=0,
        id="increment_active_days", replace_existing=True,
    )
    scheduler.add_job(
        purge_old_workout_data,
        trigger="cron", hour=3, minute=15,
        id="purge_old_workout_data", replace_existing=True,
    )
    scheduler.add_job(
        cleanup_dead_partnerships,
        trigger="cron", hour=3, minute=30,
        id="cleanup_dead_partnerships", replace_existing=True,
    )

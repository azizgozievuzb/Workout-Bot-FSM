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

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, LabeledPrice

from ..core.config import settings
from ..db.client import get_supabase
from ..services import schedule as sched
from ..services.notifications import emit_notification
from ..services.bot_notify import send_bot_message
from ..services.shelf import SUBSCRIPTION_WARN_DAYS
from ..services.tier_pricing import (
    SUBSCRIPTION_GRACE_DAYS,
    base_price,
    get_tier_price_row,
    insert_tier_payment,
    invoice_description,
    invoice_title,
)

logger = logging.getLogger(__name__)

# Э.3.2: напоминание за столько дней до истечения. Порог тот же, что красит чип
# и шапку Market R, — одно число на весь продукт.
RENEWAL_REMINDER_DAYS = SUBSCRIPTION_WARN_DAYS
# Тихое окно в поясе наставника: [22:00, 09:00) — счета ночью не шлём.
QUIET_START_HOUR = 22
QUIET_END_HOUR = 9


def _get_bot_safe():
    try:
        from ..core.deps import get_bot
        return get_bot()
    except Exception as e:  # bot not initialised (e.g. cron before lifespan)
        logger.info("[sub_lifecycle] bot not available (%s)", e)
        return None


def _parse_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


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


# ---------------------------------------------------------------------------
# Jobs A/B — subscription renewal (task 7.5). Money lives on the Responsible.
# ---------------------------------------------------------------------------

async def _send_renewal_invoice(db, bot, user_row: dict, expired: bool) -> bool:
    """Send a 1-month renewal invoice (sendInvoice, XTR) to the Responsible's chat.

    Creates a pending tier payment snapshot; the successful_payment handler fulfils it.
    Returns True if the invoice was sent.
    """
    tier = user_row.get("responsible_access_tier") or "standard"
    tg_id = user_row.get("telegram_id")
    if not tg_id:
        return False
    price_row = await get_tier_price_row(db, tier)
    price = base_price(price_row, "1m") if price_row else None
    if not price:
        logger.error("[sub_lifecycle] no 1m price for tier=%s", tier)
        return False

    try:
        payment_id = await insert_tier_payment(db, user_row["id"], tier, "1m", price)
    except Exception as e:
        logger.error("[sub_lifecycle] renewal payment insert failed uid=%s: %s", user_row["id"], e)
        return False

    miniapp_url = f"https://t.me/{settings.BOT_USERNAME}?startapp=renew"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"Заплатить {price} ⭐", pay=True)],
        [InlineKeyboardButton(text="Другие варианты", url=miniapp_url)],
    ])
    header = "❗️ Подписка истекла." if expired else "⏳ Подписка скоро истекает."
    title = invoice_title(tier, "1m")
    try:
        await bot.send_invoice(
            chat_id=tg_id,
            title=title,
            description=f"{header} {invoice_description(tier, '1m')}",
            payload=payment_id,
            currency="XTR",
            prices=[LabeledPrice(label=title, amount=price)],
            reply_markup=kb,
        )
        return True
    except Exception as e:
        logger.error("[sub_lifecycle] send_invoice failed tg=%s: %s", tg_id, e)
        try:
            await (
                db.table("payments").update({"status": "failed"})
                .eq("id", payment_id).eq("status", "pending").execute()
            )
        except Exception:
            pass
        return False


async def _responsibles() -> list[dict]:
    db = await get_supabase()
    res = await (
        db.table("users")
        .select("id, telegram_id, responsible_access_tier, subscription_expires_at, "
                "last_renewal_reminder_at, pricing_mode, timezone")
        .eq("has_responsible_access", True)
        .execute()
    )
    return res.data or []


def _in_quiet_hours(tz_str: str | None, now: datetime) -> bool:
    """Тихое окно 22:00–09:00 в поясе НАСТАВНИКА (Э.3.2).

    Джоб крутится ежечасно, поэтому окно решает не расписание, а эта проверка:
    у наставника в UTC-8 «09:00 UTC» — час ночи, счёт среди ночи так себе
    напоминание.
    """
    local_hour = sched.local_now(tz_str, base=now).hour
    return local_hour < QUIET_END_HOUR or local_hour >= QUIET_START_HOUR


async def send_renewal_reminders() -> None:
    """Job A (ежечасно) — Ответственным за ≤3 дня до истечения шлём счёт-напоминание.

    Только pricing_mode IS NULL; не чаще раза в день по ЛОКАЛЬНОЙ дате наставника
    и только вне тихого окна. Фильтр — по живой подписке наставника
    (`users.subscription_expires_at`), НЕ по `partnerships.expires_at`:
    у боевых пар оно NULL, и джоб не видел бы никого (класс бага S54).
    """
    db = await get_supabase()
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=RENEWAL_REMINDER_DAYS)

    rows = await _responsibles()
    if not rows:
        return
    bot = _get_bot_safe()
    if bot is None:
        return

    for u in rows:
        if u.get("pricing_mode") is not None:
            continue
        exp = _parse_dt(u.get("subscription_expires_at"))
        if exp is None or not (now < exp <= horizon):
            continue
        tz_str = u.get("timezone")
        if _in_quiet_hours(tz_str, now):
            continue
        local_today = sched.local_today(tz_str, base=now).isoformat()
        last = u.get("last_renewal_reminder_at")
        if last and sched.local_today(tz_str, base=_parse_dt(last) or now).isoformat() == local_today:
            continue
        if await _send_renewal_invoice(db, bot, u, expired=False):
            await (
                db.table("users").update({"last_renewal_reminder_at": now.isoformat()})
                .eq("id", u["id"]).execute()
            )
            logger.info("[sub_lifecycle] Job A: renewal reminder sent uid=%s", u["id"])


async def handle_expired_subscriptions() -> None:
    """Job B (daily 09:05 UTC) — истечение + grace:
       * просроченным Ответственным (pricing_mode NULL) — ежедневный счёт-пейволл продления;
       * игрокам, чей Ответственный перешёл границу grace (3 дня) — уведомление о паузе.
    """
    db = await get_supabase()
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()

    rows = await _responsibles()
    if not rows:
        return
    bot = _get_bot_safe()

    for u in rows:
        if u.get("pricing_mode") is not None:
            continue
        exp = _parse_dt(u.get("subscription_expires_at"))
        if exp is None or exp >= now:
            continue  # not expired

        # 1) daily renewal paywall invoice (throttled once/day)
        last = u.get("last_renewal_reminder_at")
        if bot is not None and not (last and str(last)[:10] == today):
            if await _send_renewal_invoice(db, bot, u, expired=True):
                await (
                    db.table("users").update({"last_renewal_reminder_at": now.isoformat()})
                    .eq("id", u["id"]).execute()
                )

        # 2) fire the players-paused notice once, at the grace boundary
        grace_end = exp + timedelta(days=SUBSCRIPTION_GRACE_DAYS)
        if now - timedelta(days=1) <= grace_end < now:
            parts = await (
                db.table("partnerships").select("player_id")
                .eq("responsible_id", u["id"]).eq("status", "active").execute()
            )
            for p in (parts.data or []):
                pid = p.get("player_id")
                if not pid:
                    continue
                await emit_notification(
                    db, user_id=pid, type="access_paused",
                    title="⏸ Доступ на паузе",
                    message="Подписка вашего наставника истекла. Тренировки на паузе до продления.",
                    payload={},
                )
            logger.info("[sub_lifecycle] Job B: players paused for responsible uid=%s", u["id"])


def register_subscription_jobs(scheduler) -> None:
    """Вызывается из promo_lifecycle.create_scheduler (или main lifespan)."""
    # Job E (consume_streak_freezes) СНЯТ с расписания в 8a: стрик теперь
    # закрывается только по плановым main-дням в локальной TZ — этим занимается
    # schedule_lifecycle.close_streak_day. Функция оставлена как legacy (не зовётся).
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
    # 7.5 subscription renewal
    # Ежечасно: само окно «не ночью» считается в поясе наставника внутри джоба
    # (Э.3.2), одна фиксированная UTC-минута этого не умеет.
    scheduler.add_job(
        send_renewal_reminders,
        trigger="cron", minute=0,
        id="send_renewal_reminders", replace_existing=True,
    )
    scheduler.add_job(
        handle_expired_subscriptions,
        trigger="cron", hour=9, minute=5,
        id="handle_expired_subscriptions", replace_existing=True,
    )

"""Phase 8a jobs — расписание / стрик / заморозки / уведомления (TZ-aware).

Джобы:
  * close_streak_day (hourly, minute 5) — для юзеров, у кого локально наступила
    полночь (00:00–00:59): промоушен отложенной смены графика (лок. понедельник),
    затем проверка вчерашнего планового дня → списание заморозки или обнуление
    стрика. Идемпотентно (last_streak_eval_day).
  * grant_monthly_freezes (1-е число, 00:05 UTC) — reset free_freezes_left:
    Ж=3, М=1 (не копится).
  * send_workout_reminders (каждые 15 мин) — утреннее (в выбранное время) и
    вечернее (20:00 локали) напоминание в плановый день, если не тренировался.
"""
import logging
from datetime import date, datetime, timedelta, timezone

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from ..core.config import settings
from ..db.client import get_supabase
from ..services import schedule as sched
from ..services.notifications import emit_notification
from ..services.bot_notify import send_bot_message

logger = logging.getLogger(__name__)
UTC = timezone.utc

_USER_COLS = (
    "id, telegram_id, timezone, main_days, pending_main_days, pending_schedule_from, "
    "morning_reminder_time, last_morning_reminder_date, last_evening_reminder_date, "
    "light_unlocked, light_active_from, light_locked_at"
)
_STATS_COLS = (
    "player_id, current_streak, free_freezes_left, paid_freezes, streak_freeze_balance, "
    "last_closed_day, last_streak_eval_day, last_workout_date"
)


def _get_bot_safe():
    try:
        from ..core.deps import get_bot
        return get_bot()
    except Exception as e:
        logger.info("[schedule] bot not available (%s)", e)
        return None


def _as_date(v) -> date | None:
    if not v:
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except (ValueError, TypeError):
        return None


def _train_button() -> InlineKeyboardMarkup:
    url = f"https://t.me/{settings.BOT_USERNAME}?startapp=train"
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="🏋 Открыть тренировку", url=url)]]
    )


async def _active_players(db) -> list[dict]:
    """Игроки с активной подпиской (partnerships.expires_at > now, status active),
    смерженные users-конфиг + player_stats. Только те, у кого выбраны main_days."""
    now_iso = datetime.now(UTC).isoformat()
    parts = await (
        db.table("partnerships").select("player_id")
        .gt("expires_at", now_iso).eq("status", "active").execute()
    )
    ids = list({p["player_id"] for p in (parts.data or []) if p.get("player_id")})
    if not ids:
        return []

    urs = await db.table("users").select(_USER_COLS).in_("id", ids).execute()
    users = {u["id"]: u for u in (urs.data or []) if u.get("main_days")}
    if not users:
        return []

    strs = await db.table("player_stats").select(_STATS_COLS).in_("player_id", list(users)).execute()
    stats = {s["player_id"]: s for s in (strs.data or [])}

    out = []
    for uid, u in users.items():
        merged = dict(u)
        merged.update(stats.get(uid, {}))
        merged["_has_stats"] = uid in stats
        out.append(merged)
    return out


# ---------------------------------------------------------------------------
# Job: streak day closure (hourly)
# ---------------------------------------------------------------------------
async def close_streak_day() -> None:
    db = await get_supabase()
    now = datetime.now(UTC)
    players = await _active_players(db)
    if not players:
        return

    for p in players:
        pid = p["id"]
        tz = p.get("timezone")
        ln = sched.local_now(tz, base=now)
        if ln.hour != 0:
            continue  # только окно локальной полночи 00:00–00:59
        l_today = ln.date()

        # 1) Промоушен отложенной смены графика (локальный понедельник).
        pending = p.get("pending_main_days")
        pfrom = _as_date(p.get("pending_schedule_from"))
        if pending and pfrom and l_today >= pfrom:
            try:
                await (
                    db.table("users").update({
                        "main_days": pending,
                        "pending_main_days": None,
                        "pending_schedule_from": None,
                    }).eq("id", pid).execute()
                )
                p["main_days"] = pending
                logger.info("[schedule] promoted pending schedule uid=%s", pid)
            except Exception as e:
                logger.error("[schedule] promote failed uid=%s: %s", pid, e)

        if not p.get("_has_stats"):
            continue  # нет статов → нечего ломать/списывать

        yesterday = l_today - timedelta(days=1)
        eval_day = _as_date(p.get("last_streak_eval_day"))
        if eval_day is not None and eval_day >= yesterday:
            continue  # идемпотентность: вчера уже обработано

        # 8b: плановым может быть main- ИЛИ light-день (если light активен).
        was_planned = sched.planned_day_type(p, yesterday) is not None
        closed = _as_date(p.get("last_closed_day")) == yesterday

        upd = {"last_streak_eval_day": yesterday.isoformat()}
        notif = None  # (type, title, message, payload)

        if was_planned and not closed:
            free = int(p.get("free_freezes_left") or 0)
            paid = int(p.get("paid_freezes") or 0)
            legacy = int(p.get("streak_freeze_balance") or 0)  # старый кошелёк (даримые R)
            streak = int(p.get("current_streak") or 0)
            if free > 0:
                upd["free_freezes_left"] = free - 1
                upd["last_closed_day"] = yesterday.isoformat()
                notif = ("freeze_consumed", "❄️ Заморозка спасла стрик",
                         f"Пропущенный день закрыт заморозкой. Осталось бесплатных: {free - 1}.",
                         {"free_left": free - 1, "paid_left": paid})
            elif paid > 0:
                upd["paid_freezes"] = paid - 1
                upd["last_closed_day"] = yesterday.isoformat()
                notif = ("freeze_consumed", "❄️ Заморозка спасла стрик",
                         f"Пропущенный день закрыт заморозкой. Осталось докупленных: {paid - 1}.",
                         {"free_left": free, "paid_left": paid - 1})
            elif legacy > 0:
                upd["streak_freeze_balance"] = legacy - 1
                upd["last_closed_day"] = yesterday.isoformat()
                notif = ("freeze_consumed", "❄️ Заморозка спасла стрик",
                         f"Пропущенный день закрыт заморозкой. Осталось заморозок: {legacy - 1}.",
                         {"legacy_left": legacy - 1})
            elif streak > 0:
                upd["current_streak"] = 0
                # 8c: фиксируем сломанный стрик ДО обнуления — платный restore
                # (окно 72ч) читает lost_streak_len/lost_streak_at.
                upd["lost_streak_len"] = streak
                upd["lost_streak_at"] = now.isoformat()
                notif = ("streak_broken", "💔 Стрик прерван",
                         f"Ты пропустил плановый день. Было: {streak}. Начни заново!",
                         {"prev_streak": streak})

        try:
            await db.table("player_stats").update(upd).eq("player_id", pid).execute()
        except Exception as e:
            logger.error("[schedule] closure update failed uid=%s: %s", pid, e)
            continue

        if notif:
            await emit_notification(db, user_id=pid, type=notif[0], title=notif[1],
                                    message=notif[2], payload=notif[3])


# ---------------------------------------------------------------------------
# Job: monthly freeze grant (1st of month)
# ---------------------------------------------------------------------------
async def grant_monthly_freezes() -> None:
    """Reset free_freezes_left: Ж=3, М=1. Не копится (перезапись)."""
    db = await get_supabase()
    urs = await (
        db.table("users").select("id, gender")
        .eq("role", "player").execute()
    )
    rows = urs.data or []
    if not rows:
        return
    logger.info("[schedule] grant_monthly_freezes: %d players", len(rows))
    for u in rows:
        grant = 3 if (u.get("gender") == "female") else 1
        try:
            await (
                db.table("player_stats").update({"free_freezes_left": grant})
                .eq("player_id", u["id"]).execute()
            )
        except Exception as e:
            logger.error("[schedule] grant failed uid=%s: %s", u["id"], e)


# ---------------------------------------------------------------------------
# Job: workout reminders (every 15 min)
# ---------------------------------------------------------------------------
async def send_workout_reminders() -> None:
    db = await get_supabase()
    now = datetime.now(UTC)
    players = await _active_players(db)
    if not players:
        return
    bot = _get_bot_safe()
    if bot is None:
        return

    for p in players:
        tz = p.get("timezone")
        ln = sched.local_now(tz, base=now)
        l_today = ln.date()
        today_iso = l_today.isoformat()

        planned = sched.planned_day_type(p, l_today)
        if planned is None:
            continue  # сегодня не плановый день

        lwd = _as_date(p.get("last_workout_date"))
        if lwd is not None and lwd >= l_today:
            continue  # уже тренировался сегодня

        is_light = planned == "light"
        morning_text = (
            "☀️ Сегодня лёгкая зарядка — 4 упражнения на месте!"
            if is_light else "🏋 Сегодня твой день тренировки!"
        )
        evening_text = (
            "⚠️ Лёгкая зарядка ещё не сделана. Стрик в опасности!"
            if is_light else "⚠️ Сегодня ещё не тренировался. Стрик в опасности!"
        )

        mins_now = ln.hour * 60 + ln.minute

        # Утреннее — в выбранное юзером время (он сам его выбрал → тихое окно не давит).
        rt = sched.parse_reminder_time(p.get("morning_reminder_time"))
        mins_rt = rt.hour * 60 + rt.minute
        if mins_rt <= mins_now < mins_rt + 15:
            if _as_date(p.get("last_morning_reminder_date")) != l_today:
                await send_bot_message(
                    bot, p["telegram_id"], morning_text,
                    reply_markup=_train_button(),
                )
                await db.table("users").update(
                    {"last_morning_reminder_date": today_iso}
                ).eq("id", p["id"]).execute()
                continue

        # Вечернее — 20:00 локали; тихое окно 22:00–09:00 (страховка от кривых TZ).
        if 20 * 60 <= mins_now < 20 * 60 + 15 and 9 * 60 <= mins_now < 22 * 60:
            if _as_date(p.get("last_evening_reminder_date")) != l_today:
                await send_bot_message(
                    bot, p["telegram_id"], evening_text,
                    reply_markup=_train_button(),
                )
                await db.table("users").update(
                    {"last_evening_reminder_date": today_iso}
                ).eq("id", p["id"]).execute()


def register_schedule_jobs(scheduler) -> None:
    """Регистрация джобов 8a. Вызывается из create_scheduler."""
    scheduler.add_job(
        close_streak_day,
        trigger="cron", minute=5,
        id="close_streak_day", replace_existing=True,
    )
    scheduler.add_job(
        grant_monthly_freezes,
        trigger="cron", day=1, hour=0, minute=5,
        id="grant_monthly_freezes", replace_existing=True,
    )
    scheduler.add_job(
        send_workout_reminders,
        trigger="cron", minute="0,15,30,45",
        id="send_workout_reminders", replace_existing=True,
    )

"""Phase 8d jobs — полка наставника.

Джобы:
  * remind_pending_promises (hourly, minute 20) — дискомфорт наставника: пока
    выкупленное обещание не исполнено, бот напоминает ~раз в 3 дня (§8.8a п.4).
    Тихое окно 09:00–22:00 по локали наставника (как в 8a). Гаснет ТОЛЬКО когда
    игрок ставит галочку.
  * purge_fulfilled_promise_videos (daily, 03:20 UTC) — ретеншн §8.8a п.8:
    исполнено + 30 дней → видео удаляются из Storage, пути обнуляются,
    строка уходит в 'archived' (остаётся в репутации и истории трат).
"""
import logging
from datetime import datetime, timedelta, timezone

from ..db.client import get_supabase
from ..services import schedule as sched
from ..services import shelf as shelf_svc
from ..services.bot_notify import send_bot_message

logger = logging.getLogger(__name__)
UTC = timezone.utc

REMINDER_EVERY_DAYS = 3
RETENTION_DAYS = 30
QUIET_FROM_HOUR = 22      # с 22:00 локали не пишем
QUIET_UNTIL_HOUR = 9      # до 09:00 локали не пишем


def _get_bot_safe():
    try:
        from ..core.deps import get_bot
        return get_bot()
    except Exception as e:
        logger.info("[shelf] bot not available (%s)", e)
        return None


def _parse_dt(v) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Job: напоминания о невыполненных обещаниях (hourly)
# ---------------------------------------------------------------------------
async def remind_pending_promises() -> None:
    db = await get_supabase()
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=REMINDER_EVERY_DAYS)

    items_res = await (
        db.table("shelf_items")
        .select("id, partnership_id, title, price_drops, purchased_at, last_reminder_at")
        .eq("type", "promise").eq("status", "purchased")
        .execute()
    )
    items = items_res.data or []
    if not items:
        return

    # Первое напоминание — через 3 дня после покупки, дальше — раз в 3 дня.
    due = [
        it for it in items
        if (_parse_dt(it.get("last_reminder_at")) or _parse_dt(it.get("purchased_at")) or now) <= cutoff
    ]
    if not due:
        return

    pair_ids = list({str(it["partnership_id"]) for it in due})
    pairs_res = await (
        db.table("partnerships").select("id, responsible_id")
        .in_("id", pair_ids).execute()
    )
    resp_by_pair = {str(p["id"]): p.get("responsible_id") for p in (pairs_res.data or [])}

    resp_ids = list({r for r in resp_by_pair.values() if r})
    if not resp_ids:
        return
    users_res = await (
        db.table("users").select("id, telegram_id, timezone").in_("id", resp_ids).execute()
    )
    users = {u["id"]: u for u in (users_res.data or [])}

    bot = _get_bot_safe()
    if bot is None:
        return

    # Группируем по наставнику: одно сообщение на всех «висящих» обещаний.
    by_resp: dict[str, list[dict]] = {}
    for it in due:
        rid = resp_by_pair.get(str(it["partnership_id"]))
        if rid:
            by_resp.setdefault(rid, []).append(it)

    for rid, its in by_resp.items():
        u = users.get(rid)
        if not u or not u.get("telegram_id"):
            continue
        local = sched.local_now(u.get("timezone"), base=now)
        if local.hour >= QUIET_FROM_HOUR or local.hour < QUIET_UNTIL_HOUR:
            continue  # тихое окно — попробуем на следующем часе

        total = sum(int(i.get("price_drops") or 0) for i in its)
        head = its[0].get("title") or "обещание"
        text = (
            f"⏳ У тебя {len(its)} невыполненных обещаний на {total} 💧.\n"
            f"Ближайшее: «{head}».\n"
            "Игрок заплатил каплями — отметка «Выполнено» появится, когда он её поставит."
            if len(its) > 1 else
            f"⏳ Обещание «{head}» ({its[0].get('price_drops')} 💧) всё ещё не выполнено.\n"
            "Игрок заплатил за него каплями. Исполни — и он поставит галочку."
        )
        await send_bot_message(bot, int(u["telegram_id"]), text)

        try:
            await (
                db.table("shelf_items").update({"last_reminder_at": now.isoformat()})
                .in_("id", [str(i["id"]) for i in its]).execute()
            )
        except Exception as e:
            logger.error("[shelf] reminder stamp failed resp=%s: %s", rid, e)


# ---------------------------------------------------------------------------
# Job: ретеншн видео (daily)
# ---------------------------------------------------------------------------
async def purge_fulfilled_promise_videos() -> None:
    """Исполнено + 30 дней → видео из Storage удаляются, строка → 'archived'."""
    db = await get_supabase()
    cutoff = (datetime.now(UTC) - timedelta(days=RETENTION_DAYS)).isoformat()

    res = await (
        db.table("shelf_items")
        .select("id, video_path, report_video_path, fulfilled_at")
        .eq("status", "fulfilled").lt("fulfilled_at", cutoff)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return
    logger.info("[shelf] retention: %d items to archive", len(rows))

    for row in rows:
        paths = [p for p in (row.get("video_path"), row.get("report_video_path")) if p]
        if paths and not await shelf_svc.remove_promise_videos(db, paths):
            continue  # Storage не отдал — попробуем завтра, строку не трогаем
        try:
            await (
                db.table("shelf_items")
                .update({"status": "archived", "video_path": None, "report_video_path": None})
                .eq("id", row["id"]).eq("status", "fulfilled").execute()
            )
        except Exception as e:
            logger.error("[shelf] archive failed item=%s: %s", row["id"], e)


def register_shelf_jobs(scheduler) -> None:
    """Регистрация джобов 8d. Вызывается из create_scheduler."""
    scheduler.add_job(
        remind_pending_promises,
        trigger="cron", minute=20,
        id="remind_pending_promises", replace_existing=True,
    )
    scheduler.add_job(
        purge_fulfilled_promise_videos,
        trigger="cron", hour=3, minute=20,
        id="purge_fulfilled_promise_videos", replace_existing=True,
    )

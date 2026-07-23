"""One-shot live smoke for Jobs A/B (subscription renewal reminders).

ЗАПУСКАТЬ НА ПРОД-ХОСТЕ (где в окружении есть BOT_TOKEN + SUPABASE_*),
из корня репозитория:

    python -m backend.scripts.smoke_jobs_ab snapshot   # зафиксировать текущее
    python -m backend.scripts.smoke_jobs_ab job-a       # шаг Job A (счёт-напоминание)
    python -m backend.scripts.smoke_jobs_ab job-b       # шаг Job B (пейволл + пауза игрока)
    python -m backend.scripts.smoke_jobs_ab rollback     # ВЕРНУТЬ Oil в исходное

Oil (Responsible) telegram_id = 8580720783; исходный expires = 2026-12-16 16:46 UTC.
⚠️ Job A/B шлют РЕАЛЬНЫЕ сообщения в Telegram Oil. НЕ ОПЛАЧИВАТЬ счёт!
После проверки ОБЯЗАТЕЛЬНО выполнить `rollback`.
"""
import asyncio
import sys

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from ..core.config import settings
from ..core.deps import set_bot
from ..db.client import get_supabase
from ..schedulers.subscription_lifecycle import (
    send_renewal_reminders,
    handle_expired_subscriptions,
)

OIL_TG = 8580720783
ORIG_EXPIRES = "2026-12-16 16:46:00+00"


async def _snapshot(db):
    res = await (
        db.table("users")
        .select("telegram_id, subscription_expires_at, last_renewal_reminder_at, "
                "responsible_access_tier, pricing_mode")
        .eq("telegram_id", OIL_TG).maybe_single().execute()
    )
    print("SNAPSHOT Oil:", res.data)
    return res.data


async def main(cmd: str):
    # init bot + supabase
    bot = Bot(
        token=settings.BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    set_bot(bot)
    db = await get_supabase()
    try:
        if cmd == "snapshot":
            await _snapshot(db)

        elif cmd == "job-a":
            from datetime import datetime, timedelta, timezone
            new_exp = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
            await (
                db.table("users").update({
                    "subscription_expires_at": new_exp,
                    "last_renewal_reminder_at": None,
                }).eq("telegram_id", OIL_TG).execute()
            )
            print(f"[job-a] expires -> {new_exp}; last_renewal_reminder_at -> NULL")
            await send_renewal_reminders()
            print("[job-a] send_renewal_reminders() done — проверь Telegram Oil (НЕ ОПЛАЧИВАТЬ).")
            await _snapshot(db)

        elif cmd == "job-b":
            from datetime import datetime, timedelta, timezone
            new_exp = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
            await (
                db.table("users").update({
                    "subscription_expires_at": new_exp,
                    "last_renewal_reminder_at": None,
                }).eq("telegram_id", OIL_TG).execute()
            )
            print(f"[job-b] expires -> {new_exp} (за пределами grace 3д); reminder -> NULL")
            await handle_expired_subscriptions()
            print("[job-b] handle_expired_subscriptions() done — проверь Telegram: "
                  "Oil получил пейволл, игрок Cell — сообщение о паузе.")
            await _snapshot(db)

        elif cmd == "rollback":
            await (
                db.table("users").update({
                    "subscription_expires_at": ORIG_EXPIRES,
                    "last_renewal_reminder_at": None,
                }).eq("telegram_id", OIL_TG).execute()
            )
            print(f"[rollback] Oil expires -> {ORIG_EXPIRES}; reminder -> NULL")
            await _snapshot(db)

        else:
            print(__doc__)
            sys.exit(1)
    finally:
        await bot.session.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    asyncio.run(main(cmd))

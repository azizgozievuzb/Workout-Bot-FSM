"""
Scheduler factory. Jobs для subscription lifecycle зарегистрированы в subscription_lifecycle.py.
Legacy Jobs A/B/C (expire_codes / warn_expiring / hard_delete_inactive) удалены в 2.8 —
теперь TTL живёт на partnerships.expires_at, scheduler чистит через Jobs E/F/G.
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .subscription_lifecycle import register_subscription_jobs
from .schedule_lifecycle import register_schedule_jobs
from .shelf_lifecycle import register_shelf_jobs


def create_scheduler(bot) -> AsyncIOScheduler:
    """Create AsyncIO scheduler with all subscription-related jobs."""
    scheduler = AsyncIOScheduler(timezone="UTC")
    register_subscription_jobs(scheduler)
    register_schedule_jobs(scheduler)  # 8a: streak closure / freezes / reminders
    register_shelf_jobs(scheduler)     # 8d: promise reminders / video retention
    return scheduler

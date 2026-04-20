"""
Scheduler factory. Jobs для subscription lifecycle зарегистрированы в subscription_lifecycle.py.
Legacy Jobs A/B/C (expire_codes / warn_expiring / hard_delete_inactive) удалены в 2.8 —
теперь TTL живёт на partnerships.expires_at, scheduler чистит через Jobs E/F/G.
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .subscription_lifecycle import register_subscription_jobs


def create_scheduler(bot) -> AsyncIOScheduler:
    """Create AsyncIO scheduler with all subscription-related jobs."""
    scheduler = AsyncIOScheduler(timezone="UTC")
    register_subscription_jobs(scheduler)
    return scheduler

"""Tier subscription pricing + payment-row helpers (task 7.5).

Prices come ONLY from the tier_prices table. A payment row snapshots the resolved
amount/tier/period/coupon so an admin price change can never alter an open invoice.
Shared by the /payments/tier-invoice endpoint and the renewal scheduler.
"""
from datetime import datetime, timezone

# Days added to subscription_expires_at per period.
PERIOD_DAYS = {"intro": 30, "1m": 30, "3m": 90, "12m": 365}

# tier_prices column per period.
PERIOD_PRICE_COL = {
    "intro": "intro_price_stars",
    "1m": "price_1m",
    "3m": "price_3m",
    "12m": "price_12m",
}

# Grace window (days) a Player keeps access after their Responsible's subscription lapses.
SUBSCRIPTION_GRACE_DAYS = 3

TIER_TITLES = {"standard": "Standard", "premium": "Premium", "elite": "Elite"}
TIER_PLAYER_LIMITS = {"standard": 1, "premium": 2, "elite": 3}
PERIOD_LABELS = {
    "intro": "первый месяц",
    "1m": "1 месяц",
    "3m": "3 месяца",
    "12m": "12 месяцев",
}


async def get_tier_price_row(db, tier: str) -> dict | None:
    res = await (
        db.table("tier_prices")
        .select("tier, intro_price_stars, price_1m, price_3m, price_12m")
        .eq("tier", tier)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def base_price(price_row: dict, period: str) -> int | None:
    col = PERIOD_PRICE_COL.get(period)
    if not price_row or not col or col not in price_row:
        return None
    return int(price_row[col])


def apply_coupon(price: int, discount_pct: int) -> int:
    """price_after = max(1, round(price × (1 − pct/100))) — минимум 1 Star (лимит Telegram)."""
    return max(1, round(price * (1 - discount_pct / 100)))


async def insert_tier_payment(
    db, buyer_id: str, tier: str, period: str, amount: int,
    coupon_id: str | None = None, discount_pct: int | None = None,
) -> str:
    """Insert a pending tier payment (snapshot). Returns payment id."""
    ins = await (
        db.table("payments")
        .insert({
            "buyer_user_id": buyer_id,
            "product_type": f"tier_{period}",
            "tier": tier,
            "period": period,
            "amount_stars": amount,
            "coupon_id": coupon_id,
            "discount_pct": discount_pct,
            "status": "pending",
        })
        .execute()
    )
    if not ins.data:
        raise RuntimeError("failed to insert tier payment")
    return str(ins.data[0]["id"])


def invoice_title(tier: str, period: str) -> str:
    return f"Подписка {TIER_TITLES.get(tier, tier)} — {PERIOD_LABELS.get(period, period)}"


def plural_players(n: int) -> str:
    """Форма «игрок» после числа в контексте «до N …»: 1 → игрока, иначе игроков.

    Хвост шлифовки S63: в счёте на продление стояло «до 1 игрок(ов)».
    Фронтовая пара — pluralPlayers в frontend/src/utils/tierText.ts.
    """
    return "игрока" if n % 10 == 1 and n % 100 != 11 else "игроков"


def invoice_description(tier: str, period: str) -> str:
    limit = TIER_PLAYER_LIMITS.get(tier, 1)
    return (
        f"Тариф {TIER_TITLES.get(tier, tier)} (до {limit} {plural_players(limit)}). "
        f"Доступ на {PERIOD_LABELS.get(period, period)}."
    )


def now_utc() -> datetime:
    return datetime.now(timezone.utc)

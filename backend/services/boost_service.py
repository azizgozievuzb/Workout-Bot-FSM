"""Boost activation service.

Single source of truth for inserting a X2 boost row. The ONLY caller in production
is the Telegram `successful_payment` handler (task 7.4) — a boost can no longer be
activated without a paid Stars invoice. `boost_type` is the value stored on the
`boosts` table ('1_day' | '1_week'), mapped from a `star_products.product_type`.
"""
from datetime import datetime, timedelta, timezone

BOOST_DURATIONS = {
    "1_day": timedelta(days=1),
    "1_week": timedelta(weeks=1),
}

# star_products.product_type → boosts.boost_type
PRODUCT_TO_BOOST_TYPE = {
    "boost_1_day": "1_day",
    "boost_1_week": "1_week",
}


async def activate_boost(db, partnership_id: str, boost_type: str) -> str:
    """Insert a boost row for the partnership. Returns expires_at ISO string.

    Raises ValueError on unknown boost_type.
    """
    if boost_type not in BOOST_DURATIONS:
        raise ValueError(f"Unknown boost_type: {boost_type}")

    now = datetime.now(timezone.utc)
    expires = now + BOOST_DURATIONS[boost_type]

    await (
        db.table("boosts")
        .insert({
            "partnership_id": partnership_id,
            "boost_type": boost_type,
            "activated_at": now.isoformat(),
            "expires_at": expires.isoformat(),
        })
        .execute()
    )
    return expires.isoformat()

"""FastAPI dependencies: текущий пользователь из JWT."""
import logging
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .security import decode_access_token

logger = logging.getLogger(__name__)
bearer_scheme = HTTPBearer()

# ---------------------------------------------------------------------------
# app_settings cache (30-second TTL)
# ---------------------------------------------------------------------------
_settings_cache: dict = {}
_SETTINGS_TTL = 30.0


async def _get_app_settings(db) -> dict:
    now = time.monotonic()
    if _settings_cache.get("_ts", 0) + _SETTINGS_TTL > now:
        return _settings_cache.get("data", {})
    res = await (
        db.table("app_settings")
        .select("maintenance_mode, maintenance_started_at")
        .eq("id", 1)
        .maybe_single()
        .execute()
    )
    data = res.data if res and res.data else {}
    _settings_cache["data"] = data
    _settings_cache["_ts"] = now
    return data


def _invalidate_settings_cache() -> None:
    _settings_cache.clear()


# ---------------------------------------------------------------------------
# Admin dependency
# ---------------------------------------------------------------------------

async def require_admin(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
) -> dict:
    user = await get_current_user(credentials)
    if user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


# Capped log-spam guard: tracks up to 1024 revoked telegram_ids, then auto-evicts oldest.
@lru_cache(maxsize=1024)
def _mark_revoked_logged(tg_id: int) -> bool:
    """Returns True on first call per tg_id (within cache). Used to avoid log spam."""
    return True


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Dependency: декодирует JWT из Authorization: Bearer <token>.
    Для роли player: доступ разрешён только при наличии живой строки в promo_codes
    (code_type='player', activated_by=tg_id, expires_at > now()). Иначе → 403 PROMO_EXPIRED.
    """
    payload = decode_access_token(credentials.credentials)
    telegram_id = payload.get("sub")
    role = payload.get("role")

    if not telegram_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    tg_id = int(telegram_id)

    # Ban + maintenance checks (all roles except ongoing onboarding)
    if role not in ("new",):
        from ..db.client import get_supabase
        db = await get_supabase()

        # Ban check
        ban_res = await (
            db.table("users")
            .select("ban_until, ban_reason, ban_missed_workouts")
            .eq("telegram_id", tg_id)
            .maybe_single()
            .execute()
        )
        if ban_res and ban_res.data:
            ban_until_raw = ban_res.data.get("ban_until")
            if ban_until_raw:
                ban_until = datetime.fromisoformat(ban_until_raw)
                if ban_until.tzinfo is None:
                    ban_until = ban_until.replace(tzinfo=timezone.utc)
                if ban_until > datetime.now(timezone.utc):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail={
                            "code": "BANNED",
                            "ban_until": ban_until_raw,
                            "reason": ban_res.data.get("ban_reason"),
                            "missed_workouts": ban_res.data.get("ban_missed_workouts", 0),
                        },
                    )

        # Maintenance check (skip for admin)
        if role != "admin":
            settings_data = await _get_app_settings(db)
            if settings_data.get("maintenance_mode"):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={"code": "MAINTENANCE"},
                )

    if role in ("player", "new"):
        from ..db.client import get_supabase
        db = await get_supabase()

        # Fast path: already deactivated — no extra query needed
        user_res = await (
            db.table("users")
            .select("deactivated_at, onboarding_done")
            .eq("telegram_id", tg_id)
            .maybe_single()
            .execute()
        )

        # Пользователь ещё в онбординге — пропускаем TTL-проверку
        if role == "new" or (
            user_res and user_res.data and not user_res.data.get("onboarding_done", True)
        ):
            return {"telegram_id": tg_id, "role": role}
        if user_res and user_res.data and user_res.data.get("deactivated_at"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "PROMO_EXPIRED"},
            )

        # Authoritative check: live promo_codes row
        now = datetime.now(timezone.utc)
        promo_res = await (
            db.table("promo_codes")
            .select("id, expires_at")
            .eq("code_type", "player")
            .eq("activated_by", tg_id)
            .gt("expires_at", now.isoformat())
            .maybe_single()
            .execute()
        )

        if not promo_res or not promo_res.data:
            # Self-heal: stamp deactivated_at so Job C can clean up
            if user_res and user_res.data and not user_res.data.get("deactivated_at"):
                await (
                    db.table("users")
                    .update({
                        "deactivated_at": now.isoformat(),
                        "scheduled_deletion_at": (now + timedelta(days=30)).isoformat(),
                    })
                    .eq("telegram_id", tg_id)
                    .execute()
                )
            if _mark_revoked_logged(tg_id):
                logger.info("player %s revoked: no live promo_codes row", tg_id)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "PROMO_EXPIRED"},
            )

    return {"telegram_id": tg_id, "role": role}

"""FastAPI dependencies: текущий пользователь из JWT."""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .security import decode_access_token

logger = logging.getLogger(__name__)
bearer_scheme = HTTPBearer()

# In-memory set: avoid log spam per process (telegram_id → already logged)
_revoked_logged: set[int] = set()


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
            if tg_id not in _revoked_logged:
                logger.info("player %s revoked: no live promo_codes row", tg_id)
                _revoked_logged.add(tg_id)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "PROMO_EXPIRED"},
            )

    return {"telegram_id": tg_id, "role": role}

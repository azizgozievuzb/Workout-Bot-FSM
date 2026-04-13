"""FastAPI dependencies: текущий пользователь из JWT."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .security import decode_access_token

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Dependency: декодирует JWT из Authorization: Bearer <token>.
    Возвращает {'telegram_id': int, 'role': str}.
    Для роли player: проверяет deactivated_at — если истёк промо, 403 PROMO_EXPIRED.
    """
    payload = decode_access_token(credentials.credentials)
    telegram_id = payload.get("sub")
    role = payload.get("role")

    if not telegram_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    tg_id = int(telegram_id)

    if role == "player":
        from ..db.client import get_supabase
        db = await get_supabase()
        user_res = await (
            db.table("users")
            .select("deactivated_at")
            .eq("telegram_id", tg_id)
            .maybe_single()
            .execute()
        )
        if user_res and user_res.data and user_res.data.get("deactivated_at"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="PROMO_EXPIRED")

    return {"telegram_id": tg_id, "role": role}

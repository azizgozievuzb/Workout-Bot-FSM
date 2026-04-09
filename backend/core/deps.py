"""FastAPI dependencies: текущий пользователь из JWT."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .security import decode_access_token

bearer_scheme = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Dependency: декодирует JWT из Authorization: Bearer <token>.
    Возвращает {'telegram_id': int, 'role': str}.
    """
    payload = decode_access_token(credentials.credentials)
    telegram_id = payload.get("sub")
    role = payload.get("role")

    if not telegram_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    return {"telegram_id": int(telegram_id), "role": role}

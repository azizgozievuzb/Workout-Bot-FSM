"""Generate JWT tokens for E2E testing (bypasses initData validation)."""
import jwt
from datetime import datetime, timedelta, timezone

JWT_SECRET = "6444d606bfca8d888cb3acfcad7f41a9071c3e7cadbb90e32095796f6fe24820"
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24 * 30  # 30 days

ACCOUNTS = [
    {"name": "ADMIN",   "telegram_id": 32267272,    "role": "admin"},
    {"name": "R1 (Mr)", "telegram_id": 7278081310,  "role": "responsible"},
    {"name": "P1 (Dol)","telegram_id": 7458599391,  "role": "player"},
    {"name": "P2 (Aziz)","telegram_id": 156453252,  "role": "player"},
]

def create_token(telegram_id: int, role: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {"sub": str(telegram_id), "role": role, "exp": expires}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

for acc in ACCOUNTS:
    token = create_token(acc["telegram_id"], acc["role"])
    print(f"{acc['name']} (tg={acc['telegram_id']}):")
    print(f"  {token}")
    print()

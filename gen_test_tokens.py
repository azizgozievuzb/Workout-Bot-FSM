#!/usr/bin/env python3
"""Generate test JWTs for E2E testing via Railway debug endpoint."""
import json
import sys
import urllib.request
import urllib.error

API = "https://workout-bot-fsm-production-0e08.up.railway.app"
SKEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRscGR3bW1mcHpmeGNlbHhxdmxxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTcyMzExMywiZXhwIjoyMDkxMjk5MTEzfQ"
    ".qgiSF85RZ0g9ySLxSWWocG5zh8ogO7_g82NyGdQq65A"
)

USERS = {
    "admin":  32267272,
    "aziz":   156453252,
    "p3":     8580720783,
    "pf":     300099,
}

def gen_token(telegram_id: int) -> str:
    payload = json.dumps({"secret": SKEY, "telegram_id": telegram_id}).encode()
    req = urllib.request.Request(
        f"{API}/admin/debug/gen-test-token",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    return data["access_token"]

def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else list(USERS.keys())
    for name in targets:
        tg_id = USERS.get(name)
        if tg_id is None:
            print(f"Unknown user: {name}", file=sys.stderr)
            continue
        token = gen_token(tg_id)
        print(f"{name.upper()}_JWT={token}")

if __name__ == "__main__":
    main()

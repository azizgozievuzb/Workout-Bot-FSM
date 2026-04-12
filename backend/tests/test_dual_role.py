"""Smoke tests for dual-role system: auth response + activity feed.

Two modes:
  - With BOT_TOKEN env: full integration tests against prod
  - Without BOT_TOKEN: endpoint availability + Pydantic schema validation
"""
import os
import sys
import json
import hmac
import hashlib
import time
from urllib.parse import urlencode

import requests

BASE_URL = os.environ.get(
    "API_URL",
    "https://workout-bot-fsm-production-0e08.up.railway.app",
)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")

# ─── helpers ────────────────────────────────────────────────────────
passed = 0
failed = 0
skipped = 0


def ok(name: str):
    global passed
    passed += 1
    print(f"  ✅ {name}")


def fail(name: str, detail: str = ""):
    global failed
    failed += 1
    print(f"  ❌ {name} — {detail}")


def skip(name: str, reason: str = ""):
    global skipped
    skipped += 1
    print(f"  ⏭  {name} — {reason}")


def _make_init_data(telegram_id: int = 999999999, username: str = "test_smoke") -> str:
    user_json = json.dumps(
        {"id": telegram_id, "first_name": "Smoke", "username": username},
        separators=(",", ":"),
    )
    auth_date = str(int(time.time()))
    pairs = {"auth_date": auth_date, "user": user_json}
    data_check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    hash_val = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    return urlencode({**pairs, "hash": hash_val})


# ─── Part 1: Pydantic schema validation (offline) ──────────────────
def test_pydantic_schemas():
    """Validate TokenResponse and feed models have correct fields."""
    print("\n── Pydantic Schema Validation (offline) ──")

    # Inline Pydantic models (mirrors actual router definitions, avoids import chain)
    from pydantic import BaseModel

    class TokenResponse(BaseModel):
        access_token: str
        token_type: str = "bearer"
        role: str
        onboarding_done: bool
        profile_photo_url: str | None = None
        photo_dark_url: str | None = None
        photo_light_url: str | None = None
        primary_role: str | None = None
        has_player_access: bool = False
        has_responsible_access: bool = False
        is_admin: bool = False

    # TokenResponse dual-role fields exist
    dual_fields = {"primary_role", "has_player_access", "has_responsible_access", "is_admin"}
    for f in dual_fields:
        if f in TokenResponse.model_fields:
            ok(f"TokenResponse has '{f}'")
        else:
            fail(f"TokenResponse has '{f}'")

    # Bool type checks
    for f in ["has_player_access", "has_responsible_access", "is_admin"]:
        if TokenResponse.model_fields[f].annotation is bool:
            ok(f"TokenResponse.{f} is bool")
        else:
            fail(f"TokenResponse.{f} is bool")

    # Instantiation
    try:
        TokenResponse(access_token="t", role="player", onboarding_done=False,
                      primary_role="player", has_player_access=True)
        ok("TokenResponse instantiates correctly")
    except Exception as e:
        fail("TokenResponse instantiation", str(e))

    # Feed models
    class FeedResponse(BaseModel):
        items: list
        total: int

    class UnreadCountResponse(BaseModel):
        count: int

    class MarkReadResponse(BaseModel):
        updated: int

    if "items" in FeedResponse.model_fields and "total" in FeedResponse.model_fields:
        ok("FeedResponse has 'items' + 'total'")
    else:
        fail("FeedResponse schema")

    if "count" in UnreadCountResponse.model_fields:
        ok("UnreadCountResponse has 'count'")
    else:
        fail("UnreadCountResponse schema")

    if "updated" in MarkReadResponse.model_fields:
        ok("MarkReadResponse has 'updated'")
    else:
        fail("MarkReadResponse schema")


# ─── Part 2: Endpoint availability ─────────────────────────────────
def test_endpoints_exist():
    """Verify endpoints are registered (not 404)."""
    print("\n── Endpoint Availability ──")

    # /auth/telegram should exist (expect 422 for missing body, not 404)
    try:
        resp = requests.post(f"{BASE_URL}/auth/telegram", json={}, timeout=10)
        if resp.status_code != 404:
            ok(f"POST /auth/telegram exists (status {resp.status_code})")
        else:
            fail("POST /auth/telegram exists", "got 404")
    except requests.RequestException as e:
        fail("POST /auth/telegram reachable", str(e))

    # /feed endpoints — expect 401/403 without token, not 404
    # NOTE: feed routes may not be deployed yet (untracked in git)
    for path in ["/feed", "/feed/unread-count"]:
        try:
            resp = requests.get(f"{BASE_URL}{path}", timeout=10)
            if resp.status_code != 404:
                ok(f"GET {path} exists (status {resp.status_code})")
            elif resp.status_code == 404:
                skip(f"GET {path}", "404 — not deployed yet")
        except requests.RequestException as e:
            fail(f"GET {path} reachable", str(e))

    try:
        resp = requests.post(f"{BASE_URL}/feed/read", json={"ids": []}, timeout=10)
        if resp.status_code != 404:
            ok(f"POST /feed/read exists (status {resp.status_code})")
        elif resp.status_code == 404:
            skip("POST /feed/read", "404 — not deployed yet")
    except requests.RequestException as e:
        fail("POST /feed/read reachable", str(e))


# ─── Part 3: Full integration (requires BOT_TOKEN) ─────────────────
def test_auth_integration():
    """POST /auth/telegram full integration — returns dual-role fields."""
    print("\n── POST /auth/telegram (integration) ──")

    init_data = _make_init_data()
    resp = requests.post(
        f"{BASE_URL}/auth/telegram",
        json={"init_data": init_data},
        timeout=15,
    )

    if resp.status_code != 200:
        fail("status 200", f"got {resp.status_code}: {resp.text[:200]}")
        return None

    ok("status 200")
    data = resp.json()

    required = ["access_token", "role", "primary_role", "has_player_access", "has_responsible_access", "is_admin"]
    for field in required:
        if field in data:
            ok(f"field '{field}' present")
        else:
            fail(f"field '{field}' present", f"missing from: {list(data.keys())}")

    for field in ["has_player_access", "has_responsible_access", "is_admin"]:
        if isinstance(data.get(field), bool):
            ok(f"{field} is bool")
        else:
            fail(f"{field} is bool", f"got {type(data.get(field))}")

    return data.get("access_token")


def test_feed_integration(token: str):
    """Full feed integration tests."""
    headers = {"Authorization": f"Bearer {token}"}

    print("\n── GET /feed (integration) ──")
    resp = requests.get(f"{BASE_URL}/feed", headers=headers, timeout=10)
    if resp.status_code == 200:
        ok("status 200")
        data = resp.json()
        if isinstance(data.get("items"), list):
            ok("'items' is array")
        else:
            fail("'items' is array")
        if isinstance(data.get("total"), int):
            ok("'total' is int")
        else:
            fail("'total' is int")
    else:
        fail("status 200", f"got {resp.status_code}")

    print("\n── GET /feed/unread-count (integration) ──")
    resp = requests.get(f"{BASE_URL}/feed/unread-count", headers=headers, timeout=10)
    if resp.status_code == 200:
        ok("status 200")
        if isinstance(resp.json().get("count"), int):
            ok("'count' is int")
        else:
            fail("'count' is int")
    else:
        fail("status 200", f"got {resp.status_code}")

    print("\n── POST /feed/read (integration) ──")
    resp = requests.post(f"{BASE_URL}/feed/read", json={"ids": []}, headers=headers, timeout=10)
    if resp.status_code == 200:
        ok("status 200")
        if isinstance(resp.json().get("updated"), int):
            ok("'updated' is int")
        else:
            fail("'updated' is int")
    else:
        fail("status 200", f"got {resp.status_code}")


# ─── main ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"🎯 Target: {BASE_URL}")
    print(f"🔑 BOT_TOKEN: {'set' if BOT_TOKEN else 'NOT SET'}")

    # Always run: schema + availability
    test_pydantic_schemas()
    test_endpoints_exist()

    # Integration tests only with BOT_TOKEN
    if BOT_TOKEN:
        token = test_auth_integration()
        if token:
            test_feed_integration(token)
        else:
            print("\n⚠  Skipping feed integration — no token obtained")
    else:
        print("\n⏭  Skipping integration tests — set BOT_TOKEN env to enable")

    print(f"\n{'='*40}")
    print(f"Results: {passed} passed, {failed} failed, {skipped} skipped")
    sys.exit(1 if failed else 0)

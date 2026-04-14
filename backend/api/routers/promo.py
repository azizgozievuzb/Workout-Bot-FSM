"""Promo code endpoints: activate, my-player-code, activate-link, player-status."""
import math
import string
import uuid
from datetime import datetime, timedelta, timezone
from random import choices

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.config import settings
from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/promo", tags=["promo"])

MAX_ATTEMPTS = 3
LOCK_DURATION_HOURS = 1


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ActivatePromoRequest(BaseModel):
    code: str


class ActivatePromoResponse(BaseModel):
    success: bool
    role_granted: str  # "responsible" | "player" | "admin"
    message: str
    player_code: str | None = None
    responsible_name: str | None = None


class MyPlayerCodeResponse(BaseModel):
    code: str | None = None
    deep_link: str | None = None
    is_used: bool = False
    used_by_name: str | None = None
    duration_days: int | None = None
    expires_at: str | None = None
    days_left: int | None = None


class PlayerStatusResponse(BaseModel):
    is_active: bool
    expires_at: str | None = None
    days_left: int | None = None
    duration_days: int | None = None


class ActivateLinkResponse(BaseModel):
    success: bool
    role_granted: str
    message: str
    responsible_name: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(choices(alphabet, k=length))


def _compute_days_left(expires_at_str: str | None) -> int | None:
    if not expires_at_str:
        return None
    try:
        exp = datetime.fromisoformat(expires_at_str)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        delta = exp - datetime.now(timezone.utc)
        return max(0, math.ceil(delta.total_seconds() / 86400))
    except Exception:
        return None


async def _check_rate_limit(db, user_data: dict) -> dict | None:
    locked_until = user_data.get("promo_locked_until")
    if locked_until:
        if isinstance(locked_until, str):
            locked_until = datetime.fromisoformat(locked_until)
        if locked_until > datetime.now(timezone.utc):
            minutes_left = int((locked_until - datetime.now(timezone.utc)).total_seconds() / 60) + 1
            return {"error": True, "minutes_left": minutes_left}
    return None


async def _increment_attempts(db, telegram_id: int, current_attempts: int):
    new_attempts = current_attempts + 1
    update = {"promo_attempts": new_attempts}
    if new_attempts >= MAX_ATTEMPTS:
        update["promo_locked_until"] = (
            datetime.now(timezone.utc) + timedelta(hours=LOCK_DURATION_HOURS)
        ).isoformat()
    await db.table("users").update(update).eq("telegram_id", telegram_id).execute()
    return new_attempts


async def _reset_attempts(db, telegram_id: int):
    await (
        db.table("users")
        .update({"promo_attempts": 0, "promo_locked_until": None})
        .eq("telegram_id", telegram_id)
        .execute()
    )


async def _create_player_code(
    db, responsible_id: str, tier: str = "basic",
    parent_code_id: str | None = None, duration_days: int = 30,
) -> str:
    """Generate a player_code for a responsible/admin. Returns the code string."""
    code_str = _generate_code(8)
    token = str(uuid.uuid4())
    insert_data = {
        "code": code_str,
        "code_type": "player",
        "tier": tier,
        "responsible_id": responsible_id,
        "deep_link_token": token,
        "is_used": False,
        "duration_days": duration_days,
    }
    if parent_code_id:
        insert_data["parent_code_id"] = parent_code_id
    await db.table("promo_codes").insert(insert_data).execute()
    return code_str


async def _activate_player_code(db, user_id: str, telegram_id: int, code_row: dict) -> ActivatePromoResponse:
    """Activate a player_code: create partnership, mark used, set TTL fields."""
    responsible_id = code_row["responsible_id"]

    if responsible_id == user_id:
        raise HTTPException(status_code=400, detail="Нельзя использовать свой собственный код")

    resp_res = await (
        db.table("users")
        .select("first_name")
        .eq("id", responsible_id)
        .single()
        .execute()
    )
    responsible_name = resp_res.data.get("first_name", "Ответственный")

    now = datetime.now(timezone.utc)
    duration_days = code_row.get("duration_days") or 30
    expires_at = (now + timedelta(days=duration_days)).isoformat()

    # Update user roles + clear deactivation if reactivating (Job D)
    await (
        db.table("users")
        .update({
            "primary_role": "player",
            "has_player_access": True,
            "deactivated_at": None,
            "scheduled_deletion_at": None,
        })
        .eq("telegram_id", telegram_id)
        .execute()
    )

    # Create partnership
    await (
        db.table("partnerships")
        .insert({
            "player_id": user_id,
            "responsible_id": responsible_id,
            "status": "active",
        })
        .execute()
    )

    # Mark code as used with TTL fields
    await (
        db.table("promo_codes")
        .update({
            "is_used": True,
            "used_by": user_id,
            "used_at": now.isoformat(),
            "activated_at": now.isoformat(),
            "activated_by": telegram_id,
            "expires_at": expires_at,
        })
        .eq("id", code_row["id"])
        .execute()
    )

    await _reset_attempts(db, telegram_id)

    return ActivatePromoResponse(
        success=True,
        role_granted="player",
        message=f"Вы теперь Игрок у {responsible_name}!",
        responsible_name=responsible_name,
    )


# ---------------------------------------------------------------------------
# POST /promo/activate
# ---------------------------------------------------------------------------

@router.post("/activate", response_model=ActivatePromoResponse)
async def activate_promo(
    body: ActivatePromoRequest,
    current_user: dict = Depends(get_current_user),
):
    db = await get_supabase()
    telegram_id = current_user["telegram_id"]

    user_res = await (
        db.table("users")
        .select("id, promo_attempts, promo_locked_until, is_admin")
        .eq("telegram_id", telegram_id)
        .single()
        .execute()
    )
    user_data = user_res.data
    user_id = user_data["id"]

    rate_err = await _check_rate_limit(db, user_data)
    if rate_err:
        raise HTTPException(
            status_code=429,
            detail=f"Слишком много попыток. Повторите через {rate_err['minutes_left']} мин.",
        )

    code = body.code.strip()

    if settings.ADMIN_PROMO_CODE and code == settings.ADMIN_PROMO_CODE:
        if user_data.get("is_admin"):
            return ActivatePromoResponse(success=False, role_granted="", message="Вы уже Админ.")
        await (
            db.table("users")
            .update({
                "is_admin": True,
                "has_player_access": True,
                "has_responsible_access": True,
                "primary_role": "responsible",
                "onboarding_done": True,
            })
            .eq("telegram_id", telegram_id)
            .execute()
        )
        player_code_str = await _create_player_code(db, user_id)
        await _reset_attempts(db, telegram_id)
        return ActivatePromoResponse(
            success=True,
            role_granted="admin",
            message="Добро пожаловать, Админ!",
            player_code=player_code_str,
        )

    code_res = await (
        db.table("promo_codes")
        .select("*")
        .eq("code", code)
        .execute()
    )

    if not code_res.data:
        attempts = await _increment_attempts(db, telegram_id, user_data.get("promo_attempts", 0))
        left = MAX_ATTEMPTS - attempts
        detail = "Неверный промокод."
        if left <= 0:
            detail += " Вы исчерпали 3 попытки. Повторите через 1 час."
        else:
            detail += f" Осталось попыток: {left}"
        raise HTTPException(status_code=400, detail=detail)

    code_row = code_res.data[0]

    if code_row.get("is_used"):
        await _increment_attempts(db, telegram_id, user_data.get("promo_attempts", 0))
        raise HTTPException(status_code=400, detail="Этот промокод уже был использован.")

    code_type = code_row.get("code_type", "responsible")

    if code_type == "responsible":
        await (
            db.table("users")
            .update({
                "primary_role": "responsible",
                "has_responsible_access": True,
                "subscription_tier": code_row.get("tier", "basic"),
            })
            .eq("telegram_id", telegram_id)
            .execute()
        )
        await (
            db.table("promo_codes")
            .update({
                "is_used": True,
                "used_by": user_id,
                "used_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", code_row["id"])
            .execute()
        )
        player_code_str = await _create_player_code(
            db, user_id, tier=code_row.get("tier", "basic"), parent_code_id=code_row["id"]
        )
        await _reset_attempts(db, telegram_id)
        return ActivatePromoResponse(
            success=True,
            role_granted="responsible",
            message="Поздравляю, вы теперь Ответственный!",
            player_code=player_code_str,
        )

    if code_type == "player":
        return await _activate_player_code(db, user_id, telegram_id, code_row)

    raise HTTPException(status_code=400, detail="Неизвестный тип промокода.")


# ---------------------------------------------------------------------------
# GET /promo/my-player-code   (Responsible view of issued player code)
# ---------------------------------------------------------------------------

@router.get("/my-player-code", response_model=MyPlayerCodeResponse)
async def my_player_code(current_user: dict = Depends(get_current_user)):
    db = await get_supabase()
    telegram_id = current_user["telegram_id"]

    user_res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", telegram_id)
        .single()
        .execute()
    )
    user_id = user_res.data["id"]

    codes_res = await (
        db.table("promo_codes")
        .select("code, deep_link_token, is_used, used_by, duration_days, expires_at")
        .eq("responsible_id", user_id)
        .eq("code_type", "player")
        .eq("is_used", False)
        .execute()
    )

    if not codes_res.data:
        return MyPlayerCodeResponse()

    code_row = codes_res.data[0]
    deep_link = f"https://t.me/{settings.BOT_USERNAME}?startapp={code_row['deep_link_token']}"
    expires_at = code_row.get("expires_at")
    days_left = _compute_days_left(expires_at)

    return MyPlayerCodeResponse(
        code=code_row["code"],
        deep_link=deep_link,
        is_used=False,
        duration_days=code_row.get("duration_days"),
        expires_at=expires_at,
        days_left=days_left,
    )


# ---------------------------------------------------------------------------
# GET /promo/player-status   (Player view of own access TTL)
# ---------------------------------------------------------------------------

@router.get("/player-status", response_model=PlayerStatusResponse)
async def player_status(current_user: dict = Depends(get_current_user)):
    """Returns the player's own promo expiry info. Mirrors get_current_user live-promo check."""
    # Admin and Responsible have no TTL — they never expire
    if current_user.get("role") in ("admin", "responsible"):
        return PlayerStatusResponse(is_active=True, expires_at=None, days_left=None, duration_days=None)

    db = await get_supabase()
    telegram_id = current_user["telegram_id"]

    user_res = await (
        db.table("users")
        .select("deactivated_at")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    if not user_res or not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")

    # Fast path: already deactivated
    if user_res.data.get("deactivated_at"):
        return PlayerStatusResponse(is_active=False, days_left=0)

    # Authoritative check: live promo row
    now_iso = datetime.now(timezone.utc).isoformat()
    code_res = await (
        db.table("promo_codes")
        .select("duration_days, expires_at")
        .eq("code_type", "player")
        .eq("activated_by", telegram_id)
        .gt("expires_at", now_iso)
        .maybe_single()
        .execute()
    )

    if not code_res or not code_res.data:
        return PlayerStatusResponse(is_active=False, days_left=0)

    row = code_res.data
    expires_at = row.get("expires_at")
    days_left = _compute_days_left(expires_at)

    return PlayerStatusResponse(
        is_active=True,
        expires_at=expires_at,
        days_left=days_left,
        duration_days=row.get("duration_days"),
    )


# ---------------------------------------------------------------------------
# POST /promo/activate-link/{token}
# ---------------------------------------------------------------------------

@router.post("/activate-link/{token}", response_model=ActivateLinkResponse)
async def activate_link(
    token: str,
    current_user: dict = Depends(get_current_user),
):
    db = await get_supabase()
    telegram_id = current_user["telegram_id"]

    user_res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", telegram_id)
        .single()
        .execute()
    )
    user_id = user_res.data["id"]

    code_res = await (
        db.table("promo_codes")
        .select("*")
        .eq("deep_link_token", token)
        .execute()
    )

    if not code_res.data:
        raise HTTPException(status_code=404, detail="Ссылка недействительна.")

    code_row = code_res.data[0]

    if code_row.get("is_used"):
        raise HTTPException(status_code=400, detail="Эта ссылка уже была использована.")

    if code_row.get("code_type") != "player":
        raise HTTPException(status_code=400, detail="Недопустимый тип ссылки.")

    result = await _activate_player_code(db, user_id, telegram_id, code_row)

    return ActivateLinkResponse(
        success=result.success,
        role_granted=result.role_granted,
        message=result.message,
        responsible_name=result.responsible_name,
    )

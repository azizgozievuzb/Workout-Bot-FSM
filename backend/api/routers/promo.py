"""Promo code endpoints: activate, my-player-code, activate-link, player-status."""
import math
import string
import uuid
from datetime import datetime, timedelta, timezone
from random import choices

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

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


class NewPlayerCodeRequest(BaseModel):
    duration_days: int  # must be 7 | 30 | 90 | 180; None/lifetime only for admin first code


class NewPlayerCodeResponse(BaseModel):
    code: str
    deep_link: str
    duration_days: int


class ActivateLinkResponse(BaseModel):
    success: bool
    role_granted: str
    message: str
    responsible_name: str | None = None


class RenewPlayerReq(BaseModel):
    player_id: uuid.UUID
    code: str = Field(min_length=8, max_length=32)


class RenewPlayerResp(BaseModel):
    new_expires_at: str
    added_days: int


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
    access_tier: str = "standard",
) -> str:
    """Generate a player_code for a responsible/admin. Returns the code string."""
    code_str = _generate_code(8)
    token = str(uuid.uuid4())
    insert_data = {
        "code": code_str,
        "code_type": "player",
        "tier": tier,
        "access_tier": access_tier,
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
        .maybe_single()
        .execute()
    )
    if not resp_res or not resp_res.data:
        raise HTTPException(status_code=404, detail="Ответственный не найден")
    responsible_name = resp_res.data.get("first_name", "Ответственный")

    now = datetime.now(timezone.utc)
    duration_days = code_row.get("duration_days") or 30
    expires_at = (now + timedelta(days=duration_days)).isoformat()

    # Inherit access_tier from the promo code
    code_tier = code_row.get("access_tier", "standard")

    # Update user roles + clear deactivation if reactivating (Job D)
    await (
        db.table("users")
        .update({
            "primary_role": "player",
            "has_player_access": True,
            "access_tier": code_tier,
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

    # Mark code as used with TTL fields (atomic guard — only one concurrent activation wins)
    mark_res = await (
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
        .eq("is_used", False)  # ← atomic guard: prevents double activation
        .execute()
    )
    if not mark_res.data:
        raise HTTPException(status_code=409, detail="Промокод уже активирован.")

    await _reset_attempts(db, telegram_id)

    # Auto-regenerate: create a fresh player code for the responsible
    await _create_player_code(
        db, responsible_id,
        duration_days=code_row.get("duration_days") or 30,
    )

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
                "has_player_access": False,   # не игрок до приглашения
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

    # Safe lookup: if code_type missing (migration not applied) — infer from responsible_id
    code_type = code_row.get("code_type")
    if not code_type:
        code_type = "player" if code_row.get("responsible_id") else "responsible"

    if code_type == "responsible":
        # Defensive expiry check — responsible codes may have optional expires_at
        resp_expires = code_row.get("expires_at")
        if resp_expires:
            try:
                exp_dt = datetime.fromisoformat(resp_expires)
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) > exp_dt:
                    raise HTTPException(status_code=400, detail="Срок действия промокода истёк.")
            except (ValueError, TypeError):
                pass  # malformed date — proceed, let admin handle

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
        resp_mark_res = await (
            db.table("promo_codes")
            .update({
                "is_used": True,
                "used_by": user_id,
                "used_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", code_row["id"])
            .eq("is_used", False)  # ← atomic guard
            .execute()
        )
        if not resp_mark_res.data:
            raise HTTPException(status_code=409, detail="Промокод уже активирован.")
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
# POST /promo/new-player-code   (Responsible regenerates code with chosen duration)
# ---------------------------------------------------------------------------

@router.post("/new-player-code", response_model=NewPlayerCodeResponse)
async def new_player_code(
    body: NewPlayerCodeRequest,
    current_user: dict = Depends(get_current_user),
):
    ALLOWED_DURATIONS = (7, 30, 90, 180)
    if body.duration_days not in ALLOWED_DURATIONS:
        raise HTTPException(status_code=400, detail="duration_days must be 7, 30, 90 or 180")

    role = current_user.get("role", "")
    if role not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail="Только для Ответственного или Админа")

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

    # Resolve tier: inherit from Responsible's own activated R-code
    tier_res = await (
        db.table("promo_codes")
        .select("access_tier")
        .eq("responsible_id", user_id)
        .eq("code_type", "responsible")
        .eq("is_used", True)
        .maybe_single()
        .execute()
    )
    inherited_tier = (tier_res.data.get("access_tier") if tier_res and tier_res.data else None) or "standard"

    # Expire all existing unused player codes for this responsible
    await (
        db.table("promo_codes")
        .update({"is_used": True})
        .eq("responsible_id", user_id)
        .eq("code_type", "player")
        .eq("is_used", False)
        .execute()
    )

    code_str = await _create_player_code(db, user_id, duration_days=body.duration_days, access_tier=inherited_tier)

    # Fetch token for deep link
    code_res = await (
        db.table("promo_codes")
        .select("deep_link_token")
        .eq("code", code_str)
        .single()
        .execute()
    )
    token = code_res.data["deep_link_token"]
    deep_link = f"https://t.me/{settings.BOT_USERNAME}?startapp={token}"

    return NewPlayerCodeResponse(
        code=code_str,
        deep_link=deep_link,
        duration_days=body.duration_days,
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


# ---------------------------------------------------------------------------
# POST /promo/renew-player  (Responsible extends a specific Player's access)
# ---------------------------------------------------------------------------

@router.post("/renew-player", response_model=RenewPlayerResp)
async def renew_player(
    req: RenewPlayerReq,
    current_user: dict = Depends(get_current_user),
):
    """Responsible activates a renewal-code for a specific owned Player.
    Convention: updates the Player's existing activated promo_codes row (is_used=TRUE,
    activated_by=player.telegram_id) — matches extend_active_promos_by_seconds semantics.
    """
    role = current_user.get("role", "")
    if role not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail="Только для Ответственного или Админа")

    db = await get_supabase()
    telegram_id = current_user["telegram_id"]

    user_res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", telegram_id)
        .single()
        .execute()
    )
    responsible_id = user_res.data["id"]
    player_id_str = str(req.player_id)

    # 1. Validate partnership — the target must be this responsible's player
    pair_res = await (
        db.table("partnerships")
        .select("id")
        .eq("responsible_id", responsible_id)
        .eq("player_id", player_id_str)
        .eq("status", "active")
        .maybe_single()
        .execute()
    )
    if not pair_res or not pair_res.data:
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_PLAYER"})

    # 2. Fetch renewal code
    code = req.code.strip()
    code_res = await (
        db.table("promo_codes")
        .select("id, access_tier, duration_days, is_used, code_type, is_renewal")
        .eq("code", code)
        .maybe_single()
        .execute()
    )
    if not code_res or not code_res.data:
        raise HTTPException(status_code=404, detail={"code": "CODE_INVALID"})
    code_row = code_res.data
    if (
        code_row.get("code_type") != "player"
        or not code_row.get("is_renewal")
        or code_row.get("is_used")
    ):
        raise HTTPException(status_code=404, detail={"code": "CODE_INVALID"})

    # 3. Fetch target player + tier check
    player_res = await (
        db.table("users")
        .select("telegram_id, access_tier, deactivated_at")
        .eq("id", player_id_str)
        .maybe_single()
        .execute()
    )
    if not player_res or not player_res.data:
        raise HTTPException(status_code=404, detail="Player not found")
    player = player_res.data
    player_tg = player["telegram_id"]
    if player.get("access_tier") != code_row.get("access_tier"):
        raise HTTPException(status_code=409, detail={"code": "TIER_MISMATCH"})

    # 4. Atomic mark renewal code as used (race guard)
    duration_days = int(code_row.get("duration_days") or 30)
    now = datetime.now(timezone.utc)
    mark_res = await (
        db.table("promo_codes")
        .update({
            "is_used": True,
            "used_by": player_id_str,
            "used_at": now.isoformat(),
        })
        .eq("id", code_row["id"])
        .eq("is_used", False)
        .execute()
    )
    if not mark_res.data:
        raise HTTPException(status_code=409, detail={"code": "RACE"})

    # 5. Find the Player's activated row — convention: one active row per player.
    # Update its expires_at = GREATEST(current, now) + duration_days.
    active_res = await (
        db.table("promo_codes")
        .select("id, expires_at, activated_at")
        .eq("code_type", "player")
        .eq("activated_by", player_tg)
        .eq("is_used", True)
        .order("activated_at", desc=True)
        .limit(1)
        .execute()
    )
    base = now
    if active_res.data:
        row = active_res.data[0]
        exp_raw = row.get("expires_at")
        if exp_raw:
            try:
                exp_dt = datetime.fromisoformat(exp_raw)
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                if exp_dt > now:
                    base = exp_dt
            except (ValueError, TypeError):
                pass
        new_expires_at = base + timedelta(days=duration_days)
        update_payload = {"expires_at": new_expires_at.isoformat()}
        if not row.get("activated_at"):
            update_payload["activated_at"] = now.isoformat()
        await (
            db.table("promo_codes")
            .update(update_payload)
            .eq("id", row["id"])
            .execute()
        )
    else:
        # Reactivation: no existing active row. Create one for this player.
        new_expires_at = now + timedelta(days=duration_days)
        token = str(uuid.uuid4())
        await (
            db.table("promo_codes")
            .insert({
                "code": _generate_code(8),
                "code_type": "player",
                "tier": "basic",
                "access_tier": code_row.get("access_tier", "standard"),
                "responsible_id": responsible_id,
                "deep_link_token": token,
                "is_used": True,
                "used_by": player_id_str,
                "used_at": now.isoformat(),
                "activated_at": now.isoformat(),
                "activated_by": player_tg,
                "duration_days": duration_days,
                "expires_at": new_expires_at.isoformat(),
                "is_renewal": True,
            })
            .execute()
        )

    # 6. Clear player deactivation if set (reactivation case)
    if player.get("deactivated_at"):
        await (
            db.table("users")
            .update({"deactivated_at": None, "scheduled_deletion_at": None})
            .eq("id", player_id_str)
            .execute()
        )

    # 7. Resolve all unresolved renewal_requests from this player to this responsible
    await (
        db.table("renewal_requests")
        .update({"resolved_at": now.isoformat()})
        .eq("player_id", player_id_str)
        .eq("responsible_id", responsible_id)
        .is_("resolved_at", "null")
        .execute()
    )

    return RenewPlayerResp(
        new_expires_at=new_expires_at.isoformat(),
        added_days=duration_days,
    )

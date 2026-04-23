"""Promo code endpoints: activate, my-player-code, activate-link, player-status."""
import math
import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone
from random import choices

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ...core.config import settings
from ...core.deps import get_current_user
from ...db.client import get_supabase
from ...services.notifications import emit_notification

router = APIRouter(prefix="/promo", tags=["promo"])

MAX_ATTEMPTS = 3
LOCK_DURATION_HOURS = 1

# Max players per access_tier for a Responsible
TIER_PLAYER_LIMITS: dict[str, int] = {
    "standard": 1,
    "premium": 2,
    "elite": 3,
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ActivatePromoRequest(BaseModel):
    code: str
    resurrect_partnership_id: uuid.UUID | None = None
    delete_others: bool = False


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
    access_tier: str | None = None


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


class ApplyRenewalReq(BaseModel):
    code: str = Field(min_length=8, max_length=32)


class ApplyRenewalResp(BaseModel):
    renewed_count: int
    added_days: int


class ApplyRenewalPlayerReq(BaseModel):
    code: str = Field(min_length=8, max_length=32)
    partnership_id: uuid.UUID


class ApplyRenewalPlayerResp(BaseModel):
    renewed: bool
    added_days: int
    new_expires_at: str


class ApplyBonusPackReq(BaseModel):
    code: str = Field(min_length=8, max_length=32)


class ApplyBonusPackResp(BaseModel):
    kind: str  # 'shop' | 'gift'
    added: int
    new_balance: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TIER_LETTER: dict[str, str] = {"standard": "S", "premium": "P", "elite": "E"}


def _generate_prefixed_code(role_letter: str, access_tier: str) -> str:
    """Generate 8-char code: <role_letter><tier_letter><6 random>."""
    tier_letter = _TIER_LETTER.get(access_tier, "S")
    alphabet = string.ascii_uppercase + string.digits
    return f"{role_letter}{tier_letter}" + "".join(choices(alphabet, k=6))


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
    code_str = _generate_prefixed_code("P", access_tier)
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


async def _count_active_partnerships(db, responsible_id: str) -> int:
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await (
        db.table("partnerships").select("id", count="exact")
        .eq("responsible_id", responsible_id).gt("expires_at", now_iso)
        .execute()
    )
    return res.count or 0


async def _activate_player_code(db, user_id: str, telegram_id: int, code_row: dict) -> ActivatePromoResponse:
    """Activate a player_code: create partnership, mark used, set TTL fields."""
    responsible_id = code_row["responsible_id"]

    if responsible_id == user_id:
        raise HTTPException(status_code=400, detail="Нельзя использовать свой собственный код")

    # Fetch responsible: name + tier for slot-limit check
    resp_res = await (
        db.table("users")
        .select("first_name, responsible_access_tier")
        .eq("id", responsible_id)
        .maybe_single()
        .execute()
    )
    if not resp_res or not resp_res.data:
        raise HTTPException(status_code=404, detail="Ответственный не найден")
    responsible_name = resp_res.data.get("first_name", "Ответственный")

    # Enforce player slot limit based on responsible's tier
    resp_tier = resp_res.data.get("responsible_access_tier") or "standard"
    slot_limit = TIER_PLAYER_LIMITS.get(resp_tier, 1)
    count_res = await (
        db.table("partnerships")
        .select("id", count="exact")
        .eq("responsible_id", responsible_id)
        .eq("status", "active")
        .execute()
    )
    active_count = count_res.count or 0
    if active_count >= slot_limit:
        raise HTTPException(
            status_code=409,
            detail={"code": "PLAYER_LIMIT_REACHED", "limit": slot_limit, "tier": resp_tier},
        )

    now = datetime.now(timezone.utc)
    duration_days = code_row.get("duration_days") or 30
    expires_at = (now + timedelta(days=duration_days)).isoformat()

    # Inherit access_tier from the promo code
    code_tier = code_row.get("access_tier", "standard")

    # Fetch current user flags to preserve admin/responsible dual-role
    self_res = await (
        db.table("users")
        .select("is_admin, has_responsible_access")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    self_data = self_res.data if self_res else {}
    is_dual = self_data.get("is_admin") or self_data.get("has_responsible_access")

    user_update: dict = {
        "has_player_access": True,
        "player_access_tier": code_tier,
        "deactivated_at": None,
        "scheduled_deletion_at": None,
    }
    if not is_dual:
        user_update["primary_role"] = "player"

    await (
        db.table("users")
        .update(user_update)
        .eq("telegram_id", telegram_id)
        .execute()
    )

    # Create partnership with dual-write expires_at
    _pc = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
    await (
        db.table("partnerships")
        .insert({
            "player_id": user_id,
            "responsible_id": responsible_id,
            "status": "active",
            "pairing_code": _pc,
            "pair_code": _pc,
            "expires_at": expires_at,
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
        .eq("is_used", False)
        .execute()
    )
    if not mark_res.data:
        raise HTTPException(status_code=409, detail="Промокод уже активирован.")

    await _reset_attempts(db, telegram_id)

    # Auto-regenerate: create a fresh player code inheriting the Responsible's tier
    await _create_player_code(
        db, responsible_id,
        duration_days=code_row.get("duration_days") or 30,
        access_tier=code_tier,
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
                "has_player_access": False,
                "has_responsible_access": True,
                "primary_role": "responsible",
                "responsible_access_tier": "elite",
                "onboarding_done": True,
            })
            .eq("telegram_id", telegram_id)
            .execute()
        )
        player_code_str = await _create_player_code(db, user_id, access_tier="elite")
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

    if code_type == "renewal":
        raise HTTPException(
            status_code=400,
            detail={"code": "USE_APPLY_RENEWAL",
                    "message": "Используйте эндпоинт /promo/apply-renewal"},
        )

    if code_type in ("bonus_pack_shop", "bonus_pack_gift"):
        raise HTTPException(
            status_code=400,
            detail={"code": "USE_APPLY_BONUS_PACK",
                    "message": "Используйте эндпоинт /promo/apply-bonus-pack"},
        )

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
                pass

        # Fetch user's current state for dual-role preservation
        state_res = await (
            db.table("users")
            .select("is_admin, has_responsible_access")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        state = state_res.data if state_res and state_res.data else {}
        is_dual = state.get("is_admin") or state.get("has_responsible_access")

        active_count = await _count_active_partnerships(db, user_id)
        if active_count > 0:
            raise HTTPException(
                status_code=422,
                detail={"code": "HAS_ACTIVE_PARTNERSHIPS", "active_count": active_count},
            )

        r_access_tier = code_row.get("access_tier") or "standard"
        duration_days = code_row.get("duration_days") or 30
        now = datetime.now(timezone.utc)

        if body.resurrect_partnership_id is not None:
            resurrect_id_str = str(body.resurrect_partnership_id)
            now_iso = now.isoformat()
            resurrect_res = await (
                db.table("partnerships")
                .select("id, expires_at")
                .eq("id", resurrect_id_str)
                .eq("responsible_id", user_id)
                .lt("expires_at", now_iso)
                .maybe_single()
                .execute()
            )
            if not resurrect_res or not resurrect_res.data:
                raise HTTPException(status_code=400, detail={"code": "INVALID_RESURRECT_TARGET"})

            new_expires_at = (now + timedelta(days=duration_days)).isoformat()
            await (
                db.table("partnerships")
                .update({"expires_at": new_expires_at})
                .eq("id", resurrect_id_str)
                .execute()
            )

            if body.delete_others:
                await (
                    db.table("partnerships")
                    .delete()
                    .eq("responsible_id", user_id)
                    .lt("expires_at", now_iso)
                    .neq("id", resurrect_id_str)
                    .execute()
                )

        # Always: update user role fields
        user_update: dict = {
            "has_responsible_access": True,
            "responsible_access_tier": r_access_tier,
            "subscription_tier": code_row.get("tier", "basic"),
        }
        if not is_dual:
            user_update["primary_role"] = "responsible"

        await (
            db.table("users")
            .update(user_update)
            .eq("telegram_id", telegram_id)
            .execute()
        )

        # Atomic mark promo_codes
        resp_mark_res = await (
            db.table("promo_codes")
            .update({
                "is_used": True,
                "used_by": user_id,
                "used_at": now.isoformat(),
            })
            .eq("id", code_row["id"])
            .eq("is_used", False)
            .execute()
        )
        if not resp_mark_res.data:
            raise HTTPException(status_code=409, detail="Промокод уже активирован.")

        player_code_str = await _create_player_code(
            db, user_id,
            tier=code_row.get("tier", "basic"),
            parent_code_id=code_row["id"],
            access_tier=r_access_tier,
            duration_days=duration_days,
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
        .select("code, deep_link_token, is_used, used_by, duration_days, expires_at, access_tier")
        .eq("responsible_id", user_id)
        .eq("code_type", "player")
        .eq("is_used", False)
        .like("code", "P%")
        .order("created_at", desc=True)
        .limit(1)
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
        access_tier=code_row.get("access_tier"),
    )


# ---------------------------------------------------------------------------
# GET /promo/player-status   (Player view of own access TTL)
# ---------------------------------------------------------------------------

@router.get("/player-status", response_model=PlayerStatusResponse)
async def player_status(current_user: dict = Depends(get_current_user)):
    """Returns the player's own promo expiry info. Source of truth: partnerships.expires_at."""
    if current_user.get("role") in ("admin", "responsible"):
        return PlayerStatusResponse(is_active=True, expires_at=None, days_left=None, duration_days=None)

    db = await get_supabase()
    telegram_id = current_user["telegram_id"]

    user_res = await (
        db.table("users")
        .select("id, deactivated_at")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    if not user_res or not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")

    user_row = user_res.data
    if user_row.get("deactivated_at"):
        return PlayerStatusResponse(is_active=False, days_left=0)

    user_id = user_row["id"]
    now_iso = datetime.now(timezone.utc).isoformat()

    pair_res = await (
        db.table("partnerships")
        .select("expires_at")
        .eq("player_id", user_id)
        .order("expires_at", desc=True)
        .limit(1)
        .execute()
    )

    if not pair_res or not pair_res.data:
        return PlayerStatusResponse(is_active=False, days_left=0)

    row = pair_res.data[0]
    expires_at = row.get("expires_at")
    if not expires_at or expires_at <= now_iso:
        return PlayerStatusResponse(is_active=False, days_left=0)

    return PlayerStatusResponse(
        is_active=True,
        expires_at=expires_at,
        days_left=_compute_days_left(expires_at),
        duration_days=None,
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

    # Resolve tier: inherit from Responsible's own stored tier
    tier_res = await (
        db.table("users")
        .select("responsible_access_tier")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    inherited_tier = (tier_res.data.get("responsible_access_tier") if tier_res and tier_res.data else None) or "standard"

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
# POST /promo/apply-renewal
# ---------------------------------------------------------------------------

@router.post("/apply-renewal", response_model=ApplyRenewalResp)
async def apply_renewal(req: ApplyRenewalReq, current_user: dict = Depends(get_current_user)):
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

    # Validate code before marking used
    code = req.code.strip()
    code_res = await (
        db.table("promo_codes")
        .select("id, duration_days, code_type, is_used")
        .eq("code", code)
        .maybe_single()
        .execute()
    )
    if not code_res or not code_res.data:
        raise HTTPException(status_code=404, detail={"code": "CODE_INVALID"})
    code_row = code_res.data
    if code_row.get("code_type") != "renewal" or code_row.get("is_used"):
        raise HTTPException(status_code=404, detail={"code": "CODE_INVALID"})

    # Check active partnerships BEFORE marking used (no orphaned mark if 0 active)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    active_res = await (
        db.table("partnerships")
        .select("id, player_id, expires_at")
        .eq("responsible_id", user_id)
        .gt("expires_at", now_iso)
        .execute()
    )
    pairs = active_res.data or []
    if not pairs:
        raise HTTPException(status_code=422, detail={"code": "NO_PARTNERSHIPS_TO_RENEW"})

    # Atomic mark used
    mark_res = await (
        db.table("promo_codes")
        .update({
            "is_used": True,
            "used_by": user_id,
            "used_at": now_iso,
        })
        .eq("id", code_row["id"])
        .eq("is_used", False)
        .execute()
    )
    if not mark_res.data:
        raise HTTPException(status_code=409, detail={"code": "RACE"})

    duration_days = int(code_row.get("duration_days") or 30)

    # Bulk-update expires_at for each active partnership
    for pair in pairs:
        exp_raw = pair.get("expires_at")
        base = now
        if exp_raw:
            try:
                exp_dt = datetime.fromisoformat(exp_raw)
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                if exp_dt > now:
                    base = exp_dt
            except (ValueError, TypeError):
                pass
        new_expires = (base + timedelta(days=duration_days)).isoformat()
        await (
            db.table("partnerships")
            .update({"expires_at": new_expires})
            .eq("id", pair["id"])
            .execute()
        )

        player_id = pair.get("player_id")
        if player_id:
            await emit_notification(
                db,
                user_id=player_id,
                type="partnership_renewed",
                title="✨ Доступ продлён",
                message=f"Ответственный продлил твой доступ на {duration_days} дн.",
                payload={"duration_days": duration_days, "new_expires_at": new_expires},
            )

    return ApplyRenewalResp(renewed_count=len(pairs), added_days=duration_days)


# ---------------------------------------------------------------------------
# POST /promo/apply-renewal-player  — продление одного конкретного партнёрства
# ---------------------------------------------------------------------------

@router.post("/apply-renewal-player", response_model=ApplyRenewalPlayerResp)
async def apply_renewal_player(req: ApplyRenewalPlayerReq, current_user: dict = Depends(get_current_user)):
    role = current_user.get("role", "")
    if role not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail="Только для Ответственного или Админа")

    db = await get_supabase()
    telegram_id = current_user["telegram_id"]

    user_res = await (
        db.table("users").select("id").eq("telegram_id", telegram_id).single().execute()
    )
    user_id = user_res.data["id"]

    # Validate code
    code = req.code.strip()
    code_res = await (
        db.table("promo_codes")
        .select("id, duration_days, code_type, is_used")
        .eq("code", code)
        .maybe_single()
        .execute()
    )
    if not code_res or not code_res.data:
        raise HTTPException(status_code=404, detail={"code": "CODE_INVALID"})
    code_row = code_res.data
    if code_row.get("code_type") != "renewal" or code_row.get("is_used"):
        raise HTTPException(status_code=404, detail={"code": "CODE_INVALID"})

    # Validate partnership belongs to this Responsible
    pair_res = await (
        db.table("partnerships")
        .select("id, player_id, expires_at")
        .eq("id", str(req.partnership_id))
        .eq("responsible_id", user_id)
        .maybe_single()
        .execute()
    )
    if not pair_res or not pair_res.data:
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_PARTNERSHIP"})

    # Atomic mark used
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    mark_res = await (
        db.table("promo_codes")
        .update({"is_used": True, "used_by": user_id, "used_at": now_iso})
        .eq("id", code_row["id"])
        .eq("is_used", False)
        .execute()
    )
    if not mark_res.data:
        raise HTTPException(status_code=409, detail={"code": "RACE"})

    duration_days = int(code_row.get("duration_days") or 30)
    pair = pair_res.data
    exp_raw = pair.get("expires_at")
    base = now
    if exp_raw:
        try:
            exp_dt = datetime.fromisoformat(exp_raw)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            if exp_dt > now:
                base = exp_dt
        except (ValueError, TypeError):
            pass
    new_expires = (base + timedelta(days=duration_days)).isoformat()

    await (
        db.table("partnerships")
        .update({"expires_at": new_expires})
        .eq("id", pair["id"])
        .execute()
    )

    player_id = pair.get("player_id")
    if player_id:
        await emit_notification(
            db,
            user_id=player_id,
            type="partnership_renewed",
            title="✨ Доступ продлён",
            message=f"Ответственный продлил твой доступ на {duration_days} дн.",
            payload={"duration_days": duration_days, "new_expires_at": new_expires},
        )

    return ApplyRenewalPlayerResp(renewed=True, added_days=duration_days, new_expires_at=new_expires)


# ---------------------------------------------------------------------------
# POST /promo/apply-bonus-pack
# ---------------------------------------------------------------------------

@router.post("/apply-bonus-pack", response_model=ApplyBonusPackResp)
async def apply_bonus_pack(req: ApplyBonusPackReq, current_user: dict = Depends(get_current_user)):
    role = current_user.get("role", "")
    if role not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail="Только для Ответственного или Админа")

    db = await get_supabase()
    telegram_id = current_user["telegram_id"]

    user_res = await (
        db.table("users")
        .select("id, shop_freeze_balance, gift_freeze_balance")
        .eq("telegram_id", telegram_id)
        .single()
        .execute()
    )
    user_data = user_res.data
    user_id = user_data["id"]
    current_shop = user_data.get("shop_freeze_balance") or 0
    current_gift = user_data.get("gift_freeze_balance") or 0

    # Fetch and validate code
    code = req.code.strip()
    code_res = await (
        db.table("promo_codes")
        .select("id, code_type, is_used, freeze_count")
        .eq("code", code)
        .maybe_single()
        .execute()
    )
    if not code_res or not code_res.data:
        raise HTTPException(status_code=404, detail={"code": "CODE_INVALID"})
    code_row = code_res.data
    if code_row.get("code_type") not in ("bonus_pack_shop", "bonus_pack_gift") or code_row.get("is_used"):
        raise HTTPException(status_code=404, detail={"code": "CODE_INVALID"})

    # Atomic mark used
    now = datetime.now(timezone.utc)
    mark_res = await (
        db.table("promo_codes")
        .update({
            "is_used": True,
            "used_by": user_id,
            "used_at": now.isoformat(),
        })
        .eq("id", code_row["id"])
        .eq("is_used", False)
        .execute()
    )
    if not mark_res.data:
        raise HTTPException(status_code=409, detail={"code": "RACE"})

    add = int(code_row.get("freeze_count") or 0)
    code_type = code_row["code_type"]

    if code_type == "bonus_pack_shop":
        kind = "shop"
        balance_field = "shop_freeze_balance"
        current = current_shop
        pocket_label = "Магазин"
    else:
        kind = "gift"
        balance_field = "gift_freeze_balance"
        current = current_gift
        pocket_label = "Подарки"

    # Optimistic update with 1 retry on race
    for _ in range(2):
        upd_res = await (
            db.table("users")
            .update({balance_field: current + add})
            .eq("id", user_id)
            .eq(balance_field, current)
            .execute()
        )
        if upd_res.data:
            await emit_notification(
                db,
                user_id=user_id,
                type="bonus_pack_credited",
                title="❄️ Пачка заморозок зачислена",
                message=f"+{add} шт. в кошелёк «{pocket_label}»",
                payload={"freeze_count": add, "pocket": kind},
            )
            return ApplyBonusPackResp(kind=kind, added=add, new_balance=current + add)
        fresh_res = await (
            db.table("users")
            .select(balance_field)
            .eq("id", user_id)
            .single()
            .execute()
        )
        current = fresh_res.data.get(balance_field) or 0

    raise HTTPException(status_code=409, detail={"code": "RACE"})

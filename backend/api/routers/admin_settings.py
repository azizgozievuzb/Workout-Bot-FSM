"""Admin settings: maintenance mode toggle, user ban/unban."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ...core.deps import require_admin, _invalidate_settings_cache
from ...core.config import settings
from ...db.client import get_supabase

router = APIRouter(prefix="/admin", tags=["admin-settings"])


class MaintenanceStatusResp(BaseModel):
    maintenance_mode: bool
    started_at: str | None = None
    frozen_seconds: int | None = None


class ToggleMaintenanceResp(BaseModel):
    maintenance_mode: bool
    frozen_seconds: int | None = None


class BanUserReq(BaseModel):
    days: int = Field(ge=1, le=30, default=2)
    reason: str = Field(min_length=3, max_length=500)
    missed_workouts: int = Field(ge=0, le=10, default=2)


@router.get("/maintenance/status", response_model=MaintenanceStatusResp)
async def maintenance_status(user=Depends(require_admin)):
    db = await get_supabase()
    res = await (
        db.table("app_settings")
        .select("maintenance_mode, maintenance_started_at")
        .eq("id", 1)
        .single()
        .execute()
    )
    data = res.data
    if not data.get("maintenance_mode"):
        return MaintenanceStatusResp(maintenance_mode=False)
    started_raw = data.get("maintenance_started_at")
    started = datetime.fromisoformat(started_raw) if started_raw else None
    if started and started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    frozen = int((datetime.now(timezone.utc) - started).total_seconds()) if started else 0
    return MaintenanceStatusResp(
        maintenance_mode=True,
        started_at=started_raw,
        frozen_seconds=frozen,
    )


@router.post("/maintenance/toggle", response_model=ToggleMaintenanceResp)
async def toggle_maintenance(user=Depends(require_admin)):
    db = await get_supabase()
    now = datetime.now(timezone.utc)

    res = await (
        db.table("app_settings")
        .select("maintenance_mode, maintenance_started_at")
        .eq("id", 1)
        .single()
        .execute()
    )
    current = res.data
    is_on = current.get("maintenance_mode", False)

    frozen_seconds: int | None = None

    if not is_on:
        # Turn ON
        await (
            db.table("app_settings")
            .update({
                "maintenance_mode": True,
                "maintenance_started_at": now.isoformat(),
                "updated_at": now.isoformat(),
            })
            .eq("id", 1)
            .execute()
        )
        _invalidate_settings_cache()
        return ToggleMaintenanceResp(maintenance_mode=True)
    else:
        # Turn OFF — extend active promo TTLs by frozen delta
        started_at_raw = current.get("maintenance_started_at")
        if started_at_raw:
            started_at = datetime.fromisoformat(started_at_raw)
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)
            delta = now - started_at
            frozen_seconds = int(delta.total_seconds())
            if frozen_seconds > 0:
                # Extend all active (used, non-expired) promo TTLs by the frozen delta
                await db.rpc(
                    "extend_active_promos_by_seconds",
                    {"p_seconds": frozen_seconds},
                ).execute()

        await (
            db.table("app_settings")
            .update({
                "maintenance_mode": False,
                "maintenance_started_at": None,
                "updated_at": now.isoformat(),
            })
            .eq("id", 1)
            .execute()
        )
        _invalidate_settings_cache()
        return ToggleMaintenanceResp(maintenance_mode=False, frozen_seconds=frozen_seconds)


@router.post("/users/{user_id}/ban")
async def ban_user(user_id: UUID, req: BanUserReq, user=Depends(require_admin)):
    from datetime import timedelta
    db = await get_supabase()
    now = datetime.now(timezone.utc)
    ban_until = (now + timedelta(days=req.days)).isoformat()

    res = await (
        db.table("users")
        .update({
            "ban_until": ban_until,
            "ban_reason": req.reason,
            "ban_missed_workouts": req.missed_workouts,
        })
        .eq("id", str(user_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")

    # Lookup admin UUID for audit trail
    admin_res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", user["telegram_id"])
        .maybe_single()
        .execute()
    )
    admin_uuid = admin_res.data["id"] if admin_res and admin_res.data else None

    await (
        db.table("ban_history")
        .insert({
            "user_id": str(user_id),
            "banned_by": admin_uuid,
            "ban_until": ban_until,
            "reason": req.reason,
            "missed_workouts": req.missed_workouts,
        })
        .execute()
    )
    return {"banned": True, "ban_until": ban_until}


@router.post("/users/{user_id}/unban")
async def unban_user(user_id: UUID, user=Depends(require_admin)):
    db = await get_supabase()
    now = datetime.now(timezone.utc)

    res = await (
        db.table("users")
        .update({
            "ban_until": None,
            "ban_reason": None,
            "ban_missed_workouts": 0,
        })
        .eq("id", str(user_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")

    # Stamp unbanned_early_at on the active ban_history record
    await (
        db.table("ban_history")
        .update({"unbanned_early_at": now.isoformat()})
        .eq("user_id", str(user_id))
        .is_("unbanned_early_at", "null")
        .gt("ban_until", now.isoformat())
        .execute()
    )
    return {"banned": False}


@router.post("/debug/gen-admin-token")
async def debug_gen_admin_token(promo_code: str = Query(...)):
    """Bootstrap: validates ADMIN_PROMO_CODE and returns a short-lived admin JWT for E2E tests."""
    if not settings.ADMIN_PROMO_CODE or promo_code != settings.ADMIN_PROMO_CODE:
        raise HTTPException(status_code=401, detail="Invalid promo code")
    db = await get_supabase()
    res = (
        await db.table("users")
        .select("telegram_id")
        .eq("is_admin", True)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Admin not found")
    telegram_id = res.data[0]["telegram_id"]
    from ...core.security import create_access_token
    token = create_access_token(telegram_id, "admin")
    return {"access_token": token, "token_type": "bearer", "telegram_id": telegram_id}


@router.post("/debug/auth-payload")
async def debug_auth_payload(
    telegram_id: int = Query(...),
    user=Depends(require_admin),
):
    """Returns the same TokenResponse that /auth/telegram would return, without initData."""
    from ...api.routers.auth import _build_full_token_response, USER_SELECT_COLS
    db = await get_supabase()
    res = (
        await db.table("users")
        .select(USER_SELECT_COLS)
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    user_data = res.data if res is not None else None
    if user_data is None:
        raise HTTPException(status_code=404, detail="User not found")
    return await _build_full_token_response(db, telegram_id, user_data)

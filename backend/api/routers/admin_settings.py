"""Admin settings: maintenance mode toggle, user ban/unban."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.deps import require_admin, _invalidate_settings_cache
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
    days: int = Field(ge=1, le=30)
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
    db = await get_supabase()
    now = datetime.now(timezone.utc)
    from datetime import timedelta
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
    return {"banned": True, "ban_until": ban_until}


@router.post("/users/{user_id}/unban")
async def unban_user(user_id: UUID, user=Depends(require_admin)):
    db = await get_supabase()
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
    return {"banned": False}

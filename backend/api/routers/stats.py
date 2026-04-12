"""Player Stats API — ActionCube + MarketCube (balance)."""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stats", tags=["stats"])


class PlayerStatsResponse(BaseModel):
    global_score: int
    three_day_score: int
    current_streak: int
    best_streak: int
    last_workout_date: str | None
    star_balance: int
    level_window: list[int]
    rest_days_remaining: int
    rest_days_used_this_month: int


class PartnerStatsResponse(BaseModel):
    player_id: str
    first_name: str
    current_streak: int
    best_streak: int
    star_balance: int
    last_workout_date: str | None
    global_score: int


@router.get("/me", response_model=PlayerStatsResponse)
async def get_my_stats(user: dict = Depends(get_current_user)):
    logger.info("[/stats/me] START — telegram_id=%s", user.get("telegram_id"))

    try:
        db = await get_supabase()
        logger.info("[/stats/me] Supabase client OK")

        user_res = (
            await db.table("users")
            .select("id")
            .eq("telegram_id", user["telegram_id"])
            .maybe_single()
            .execute()
        )
        logger.info("[/stats/me] users query result: %s", user_res.data)

        if not user_res.data:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user_res.data["id"]
        logger.info("[/stats/me] user_id=%s", user_id)

        stats_res = (
            await db.table("player_stats")
            .select("*")
            .eq("player_id", user_id)
            .maybe_single()
            .execute()
        )
        logger.info("[/stats/me] player_stats query result: %s", stats_res.data)

        if not stats_res.data:
            logger.info("[/stats/me] No player_stats row, auto-creating...")
            try:
                insert_res = (
                    await db.table("player_stats")
                    .insert({"player_id": user_id})
                    .execute()
                )
                logger.info("[/stats/me] Insert result: %s", insert_res.data)
                stats_res.data = insert_res.data[0] if insert_res.data else {}
            except Exception as e:
                logger.error("[/stats/me] Insert FAILED: %s", e)
                stats_res.data = {}

        d = stats_res.data or {}
        logger.info("[/stats/me] Building response from: %s", d)

        response = PlayerStatsResponse(
            global_score=d.get("global_score", 0),
            three_day_score=d.get("three_day_score", 0),
            current_streak=d.get("current_streak", 0),
            best_streak=d.get("best_streak", 0),
            last_workout_date=d.get("last_workout_date"),
            star_balance=d.get("star_balance", 0),
            level_window=d.get("level_window", [1, 2, 3]),
            rest_days_remaining=d.get("rest_days_remaining", 3),
            rest_days_used_this_month=d.get("rest_days_used_this_month", 0),
        )
        logger.info("[/stats/me] SUCCESS")
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[/stats/me] UNEXPECTED ERROR: %s", e)
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


@router.get("/partner", response_model=list[PartnerStatsResponse])
async def get_partner_stats(user: dict = Depends(get_current_user)):
    """Responsible получает статистику своих игроков."""
    db = await get_supabase()

    user_res = (
        await db.table("users")
        .select("id")
        .eq("telegram_id", user["telegram_id"])
        .maybe_single()
        .execute()
    )
    if not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")
    user_id = user_res.data["id"]

    # Найти все активные партнёрства где я — Responsible
    partnerships_res = (
        await db.table("partnerships")
        .select("player_id")
        .eq("responsible_id", user_id)
        .eq("status", "active")
        .execute()
    )

    if not partnerships_res.data:
        return []

    player_ids = [p["player_id"] for p in partnerships_res.data]

    # Получить имена игроков
    users_res = (
        await db.table("users")
        .select("id, first_name")
        .in_("id", player_ids)
        .execute()
    )
    names = {u["id"]: u["first_name"] for u in (users_res.data or [])}

    # Получить статистику
    stats_res = (
        await db.table("player_stats")
        .select("*")
        .in_("player_id", player_ids)
        .execute()
    )

    result = []
    for s in (stats_res.data or []):
        pid = s["player_id"]
        result.append(PartnerStatsResponse(
            player_id=pid,
            first_name=names.get(pid, ""),
            current_streak=s.get("current_streak", 0),
            best_streak=s.get("best_streak", 0),
            star_balance=s.get("star_balance", 0),
            last_workout_date=s.get("last_workout_date"),
            global_score=s.get("global_score", 0),
        ))

    return result


@router.get("/debug")
async def debug_stats(user: dict = Depends(get_current_user)):
    """Temporary debug endpoint — remove after fixing."""
    db = await get_supabase()
    steps = {}

    try:
        user_res = await db.table("users").select("id").eq("telegram_id", user["telegram_id"]).maybe_single().execute()
        steps["1_user_lookup"] = {"ok": True, "data": user_res.data}
    except Exception as e:
        steps["1_user_lookup"] = {"ok": False, "error": str(e)}
        return steps

    user_id = user_res.data["id"] if user_res.data else None
    if not user_id:
        steps["1_user_lookup"]["note"] = "user not found"
        return steps

    try:
        stats_res = await db.table("player_stats").select("*").eq("player_id", user_id).maybe_single().execute()
        steps["2_stats_query"] = {"ok": True, "data": stats_res.data}
    except Exception as e:
        steps["2_stats_query"] = {"ok": False, "error": str(e)}

    try:
        # Test if insert would work (don't actually insert if row exists)
        if not stats_res.data:
            insert_res = await db.table("player_stats").insert({"player_id": user_id}).execute()
            steps["3_auto_create"] = {"ok": True, "data": insert_res.data}
        else:
            steps["3_auto_create"] = {"skipped": True, "reason": "row exists"}
    except Exception as e:
        steps["3_auto_create"] = {"ok": False, "error": str(e)}

    return steps

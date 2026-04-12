"""Player Stats API — ActionCube + MarketCube (balance)."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

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

    stats_res = (
        await db.table("player_stats")
        .select("*")
        .eq("player_id", user_id)
        .maybe_single()
        .execute()
    )

    if not stats_res.data:
        # Автосоздание записи для нового игрока
        try:
            insert_res = (
                await db.table("player_stats")
                .insert({"player_id": user_id})
                .execute()
            )
            stats_res.data = insert_res.data[0] if insert_res.data else {}
        except Exception:
            stats_res.data = {}

    d = stats_res.data or {}
    return PlayerStatsResponse(
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

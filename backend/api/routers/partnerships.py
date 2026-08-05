"""
/partnerships/* — REST API для Mini App.
Mini App вызывает эти endpoints напрямую (не через бота).
"""
import math
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_bot, get_current_user
from ...db.client import get_supabase
from ...services import shelf as shelf_svc
from ...services.bot_notify import send_bot_message
from ...services.notifications import emit_notification

router = APIRouter(prefix="/partnerships", tags=["partnerships"])


def _cartoon_avatar(gender: str | None) -> str:
    """Дефолт фото-карточки (privacy by default) — мультяшный ассет по полу.
    Пути — статика фронта (frontend/public/avatars/); заглушки-силуэты,
    настоящие мультяшки — контент-долг."""
    return "/avatars/cartoon_female.svg" if gender == "female" else "/avatars/cartoon_male.svg"


class MyPlayerOut(BaseModel):
    partnership_id: UUID
    id: UUID  # player user_id
    telegram_id: int
    first_name: str | None
    # 8c (8.8b): наставник видит ТОЛЬКО card_photo_url (купленную фото-карточку),
    # при её отсутствии — мультяшный ассет по полу. Styled/raw фото R не отдаём.
    card_photo_url: str
    access_tier: str
    expires_at: str | None
    is_expired: bool
    days_left: int | None
    days_since_expired: int | None
    is_deactivated: bool
    # 8d: бейдж «⏳ N» — выкупленные, но не исполненные обещания этой пары.
    pending_promises: int = 0
    # 8d.1a: «🎁 X/N» в строке Market — занятость полки видна ДО захода на неё.
    # Всего слотов у всех игроков одинаково (тариф наставника один), но отдаём
    # per-row: строке не нужно знать про тариф, чтобы себя нарисовать.
    shelf_slots_used: int = 0
    shelf_slots_total: int = 0


class DeletePartnershipResp(BaseModel):
    deleted: bool
    player_hard_deleted: bool


class PartnerInfo(BaseModel):
    telegram_id: int
    first_name: str | None
    telegram_username: str | None
    role: str
    profile_photo_url: str | None


@router.get("/my-partner", response_model=PartnerInfo | None)
async def get_my_partner(
    current_user: dict = Depends(get_current_user),
) -> PartnerInfo | None:
    """Получить данные партнёра (Player → Responsible или Responsible → Player)."""
    db = await get_supabase()

    user_res = (
        await db.table("users")
        .select("id, role")
        .eq("telegram_id", current_user["telegram_id"])
        .single()
        .execute()
    )
    user = user_res.data

    if user["role"] == "player":
        pair_res = (
            await db.table("partnerships")
            .select("responsible_id")
            .eq("player_id", user["id"])
            .eq("status", "active")
            .single()
            .execute()
        )
        if not pair_res.data or not pair_res.data.get("responsible_id"):
            return None
        partner_id = pair_res.data["responsible_id"]
    else:
        # Responsible: берём первого активного игрока (позже — список)
        pair_res = (
            await db.table("partnerships")
            .select("player_id")
            .eq("responsible_id", user["id"])
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not pair_res.data:
            return None
        partner_id = pair_res.data[0]["player_id"]

    partner_res = (
        await db.table("users")
        .select("telegram_id, first_name, telegram_username, role, profile_photo_url")
        .eq("id", partner_id)
        .single()
        .execute()
    )
    return PartnerInfo(**partner_res.data)


@router.get("/my-players", response_model=list[MyPlayerOut])
async def my_players(current_user: dict = Depends(get_current_user)) -> list[MyPlayerOut]:
    """Responsible получает свой список Игроков (active + expired) с TTL из partnerships.expires_at."""
    if current_user["role"] not in ("responsible", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Responsible only")

    db = await get_supabase()

    me_res = await (
        db.table("users")
        .select("id, responsible_access_tier")
        .eq("telegram_id", current_user["telegram_id"])
        .single()
        .execute()
    )
    responsible_id = me_res.data["id"]
    # 8d.1a: слотов на игрока — по ЖИВОМУ тиру наставника, как и везде в 8d
    # (в строку лота тир не снапшотится, принцип BACKLOG S48 №1).
    slots_total = shelf_svc.slots_for_tier(me_res.data.get("responsible_access_tier"))

    pair_res = await (
        db.table("partnerships")
        .select("id, player_id, expires_at")
        .eq("responsible_id", responsible_id)
        .execute()
    )
    pair_rows = [p for p in (pair_res.data or []) if p.get("player_id")]
    if not pair_rows:
        return []

    player_ids = [p["player_id"] for p in pair_rows]

    users_res = await (
        db.table("users")
        .select("id, telegram_id, first_name, card_photo_url, gender, player_access_tier, deactivated_at")
        .in_("id", player_ids)
        .execute()
    )
    users_by_id = {u["id"]: u for u in (users_res.data or [])}

    pair_ids = [str(p["id"]) for p in pair_rows]
    pending_by_pair = await shelf_svc.pending_counts(db, pair_ids)
    occupied_by_pair = await shelf_svc.occupied_counts(db, pair_ids)

    now = datetime.now(timezone.utc)
    out: list[MyPlayerOut] = []
    for p in pair_rows:
        u = users_by_id.get(p["player_id"])
        if not u:
            continue

        exp_raw = p.get("expires_at")
        exp: datetime | None = None
        if exp_raw:
            try:
                exp = datetime.fromisoformat(exp_raw)
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
            except Exception:
                exp = None

        if exp is None or exp <= now:
            is_expired = True
            days_left = None
            days_since_expired = (
                max(0, math.ceil((now - exp).total_seconds() / 86400))
                if exp is not None else None
            )
        else:
            is_expired = False
            days_left = max(0, math.ceil((exp - now).total_seconds() / 86400))
            days_since_expired = None

        out.append(MyPlayerOut(
            partnership_id=p["id"],
            id=u["id"],
            telegram_id=u["telegram_id"],
            first_name=u.get("first_name"),
            card_photo_url=u.get("card_photo_url") or _cartoon_avatar(u.get("gender")),
            access_tier=u.get("player_access_tier") or "standard",
            expires_at=exp_raw,
            is_expired=is_expired,
            days_left=days_left,
            days_since_expired=days_since_expired,
            is_deactivated=bool(u.get("deactivated_at")),
            pending_promises=pending_by_pair.get(str(p["id"]), 0),
            shelf_slots_used=occupied_by_pair.get(str(p["id"]), 0),
            shelf_slots_total=slots_total,
        ))

    def sort_key(row: MyPlayerOut):
        if not row.is_expired:
            # active first: больше days_left → выше
            return (0, -(row.days_left or 0))
        # expired: недавно истёкший (меньше days_since_expired) → выше
        return (1, row.days_since_expired if row.days_since_expired is not None else 10**9)

    out.sort(key=sort_key)
    return out


@router.delete("/{partnership_id}", response_model=DeletePartnershipResp)
async def delete_partnership(
    partnership_id: UUID,
    current_user: dict = Depends(get_current_user),
) -> DeletePartnershipResp:
    """Responsible удаляет партнёрство. Cascade-чистка «одиночного» Player-а."""
    if current_user["role"] not in ("responsible", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Responsible only")

    db = await get_supabase()

    me_res = await (
        db.table("users")
        .select("id")
        .eq("telegram_id", current_user["telegram_id"])
        .single()
        .execute()
    )
    me_id = me_res.data["id"]

    pair_res = await (
        db.table("partnerships")
        .select("id, responsible_id, player_id")
        .eq("id", str(partnership_id))
        .execute()
    )
    pair_rows = pair_res.data or []
    if not pair_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "PARTNERSHIP_NOT_FOUND"})
    pair = pair_rows[0]

    if pair["responsible_id"] != me_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "NOT_YOUR_PARTNERSHIP"})

    player_id = pair["player_id"]

    # Fetch player's telegram_id BEFORE any cascade deletion
    player_tg_res = await (
        db.table("users")
        .select("telegram_id")
        .eq("id", player_id)
        .maybe_single()
        .execute()
    )
    player_tg = (
        player_tg_res.data.get("telegram_id")
        if player_tg_res and player_tg_res.data
        else None
    )

    await emit_notification(
        db,
        user_id=player_id,
        type="partnership_deleted",
        title="🚪 Партнёрство завершено",
        message="Ответственный удалил ваше партнёрство.",
        payload={"responsible_id": me_id},
    )

    await (
        db.table("partnerships")
        .delete()
        .eq("id", str(partnership_id))
        .eq("responsible_id", me_id)
        .execute()
    )

    remaining_res = await (
        db.table("partnerships")
        .select("id", count="exact")
        .eq("player_id", player_id)
        .execute()
    )
    remaining = remaining_res.count if remaining_res.count is not None else len(remaining_res.data or [])

    player_hard_deleted = False
    if remaining == 0:
        user_res = await (
            db.table("users")
            .select("id, is_admin, has_responsible_access")
            .eq("id", player_id)
            .single()
            .execute()
        )
        u = user_res.data or {}
        if not u.get("is_admin") and not u.get("has_responsible_access"):
            await db.table("users").delete().eq("id", player_id).execute()
            player_hard_deleted = True
        else:
            await (
                db.table("users")
                .update({"has_player_access": False, "player_access_tier": None})
                .eq("id", player_id)
                .execute()
            )

    if player_tg:
        await send_bot_message(
            get_bot(),
            int(player_tg),
            "🚪 Ваше партнёрство завершено. Вы теперь свободны. Новый Ответственный может пригласить вас по P-коду.",
        )

    return DeletePartnershipResp(deleted=True, player_hard_deleted=player_hard_deleted)

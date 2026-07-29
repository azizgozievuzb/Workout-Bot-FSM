"""Полка наставника (Фаза 8d) — сторона Ответственного.

  GET    /shelf/catalog                      — каталог Stars-предметов + лимиты цен.
  GET    /shelf/players/{player_id}/page     — полная страница игрока (находка №9).
  POST   /shelf/promise                      — видео-обещание на полку (multipart).
  POST   /shelf/star-item                    — Stars-предмет → счёт, fulfill кладёт лот.
  PATCH  /shelf/items/{item_id}              — цена / перевыставление скрытого.
  DELETE /shelf/items/{item_id}              — убрать лот (active/hidden).
  POST   /shelf/gift-drops                   — подарить капли из gift_balance (RPC).
  GET    /shelf/items/{item_id}/video-url    — подписанная ссылка (доступна ПАРЕ).

Гейт всех R-эндпоинтов: активная подписка Ответственного + партнёрство status='active'.
Баланс капель игрока Ответственному НЕ отдаётся (§8.7).
"""
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ...core.access import compute_access
from ...core.deps import get_bot, get_current_user
from ...db.client import get_supabase
from ...services import shelf as shelf_svc
from ...services.bot_notify import send_bot_message
from ...services.notifications import emit_notification
from .payments import InvoiceResponse, create_stars_invoice

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/shelf", tags=["shelf"])

UTC = timezone.utc

_MENTOR_COLS = (
    "id, telegram_id, first_name, is_admin, has_player_access, has_responsible_access, "
    "pricing_mode, subscription_expires_at, responsible_access_tier, "
    "gift_balance, gift_freeze_balance"
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CatalogItem(BaseModel):
    key: str
    title: str
    price_stars: int


class PriceLimits(BaseModel):
    min: int
    max: int


class ShelfCatalogResp(BaseModel):
    catalog: list[CatalogItem]
    price_limits: PriceLimits
    gift_balance: int
    gift_freeze_balance: int


class ShelfItemOut(BaseModel):
    id: str
    type: str                       # 'promise' | 'star_item'
    title: str
    price_drops: int
    status: str
    star_catalog_key: str | None = None
    has_video: bool = False
    has_report: bool = False
    created_at: str | None = None
    purchased_at: str | None = None
    fulfilled_at: str | None = None


class PlayerPageResp(BaseModel):
    player_id: str
    partnership_id: str
    first_name: str | None
    card_photo_url: str
    profile_line: str
    gender: str | None = None
    xp: int
    current_streak: int
    best_streak: int
    last_workout_date: str | None = None
    slots_used: int
    slots_total: int
    shelf: list[ShelfItemOut]
    pending: list[ShelfItemOut]
    reputation_drops: int
    pending_count: int
    gift_balance: int
    gift_freeze_balance: int
    price_limits: PriceLimits
    catalog: list[CatalogItem]


class PatchItemReq(BaseModel):
    price_drops: int | None = Field(default=None, ge=1)
    status: str | None = None       # 'active' — перевыставить скрытый лот


class StarItemReq(BaseModel):
    player_id: UUID
    catalog_key: str
    price_drops: int = Field(ge=1)


class GiftDropsReq(BaseModel):
    player_id: UUID
    amount: int = Field(ge=1, le=100000)


class GiftDropsResp(BaseModel):
    gifted: int
    gift_balance: int


class VideoUrlResp(BaseModel):
    url: str | None
    expires_in: int


class OkResp(BaseModel):
    ok: bool = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _mentor(db, current_user: dict) -> dict:
    """Ответственный с ЖИВОЙ подпиской. Тир берём из строки юзера (не снапшот)."""
    if current_user.get("role") not in ("responsible", "admin"):
        raise HTTPException(status_code=403, detail={"code": "RESPONSIBLE_ONLY"})
    res = await (
        db.table("users").select(_MENTOR_COLS)
        .eq("telegram_id", current_user["telegram_id"]).maybe_single().execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})
    me = res.data
    access = await compute_access(db, me, datetime.now(UTC))
    if not access.get("active") or access.get("branch") != "responsible":
        raise HTTPException(status_code=403, detail={"code": "SUBSCRIPTION_INACTIVE"})
    me["_tier"] = access.get("tier") or me.get("responsible_access_tier")
    return me


async def _pair(db, responsible_id: str, player_id: str) -> str:
    """partnership_id живой пары (status='active') или 403."""
    res = await (
        db.table("partnerships").select("id")
        .eq("responsible_id", responsible_id).eq("player_id", str(player_id))
        .eq("status", "active").maybe_single().execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_PLAYER"})
    return str(res.data["id"])


async def _own_item(db, responsible_id: str, item_id: str) -> dict:
    """Лот полки, принадлежащий живой паре этого Ответственного."""
    res = await (
        db.table("shelf_items").select("*").eq("id", str(item_id)).maybe_single().execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND"})
    item = res.data
    pair = await (
        db.table("partnerships").select("id, responsible_id, player_id")
        .eq("id", item["partnership_id"]).maybe_single().execute()
    )
    if not pair or not pair.data or pair.data.get("responsible_id") != responsible_id:
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_ITEM"})
    item["_player_id"] = pair.data.get("player_id")
    return item


def _item_out(row: dict) -> ShelfItemOut:
    return ShelfItemOut(
        id=str(row["id"]),
        type=row["type"],
        title=row.get("title") or "",
        price_drops=int(row.get("price_drops") or 0),
        status=row.get("status") or "active",
        star_catalog_key=row.get("star_catalog_key"),
        has_video=bool(row.get("video_path")),
        has_report=bool(row.get("report_video_path")),
        created_at=row.get("created_at"),
        purchased_at=row.get("purchased_at"),
        fulfilled_at=row.get("fulfilled_at"),
    )


async def _catalog(db) -> list[CatalogItem]:
    res = await (
        db.table("shelf_catalog").select("key, title, price_stars")
        .eq("is_active", True).order("price_stars").execute()
    )
    return [CatalogItem(**r) for r in (res.data or [])]


async def _notify_player(db, player_id: str, *, type: str, title: str, message: str,
                         payload: dict | None = None, bot_text: str | None = None) -> None:
    """In-app уведомление + сообщение ботом (как в 8a)."""
    await emit_notification(db, user_id=player_id, type=type, title=title,
                            message=message, payload=payload or {})
    if not bot_text:
        return
    try:
        tg_res = await (
            db.table("users").select("telegram_id").eq("id", player_id).maybe_single().execute()
        )
        if tg_res and tg_res.data and tg_res.data.get("telegram_id"):
            await send_bot_message(get_bot(), int(tg_res.data["telegram_id"]), bot_text)
    except Exception as e:
        logger.info("[shelf] bot notify skipped player=%s: %s", player_id, e)


# ---------------------------------------------------------------------------
# GET /shelf/catalog
# ---------------------------------------------------------------------------

@router.get("/catalog", response_model=ShelfCatalogResp)
async def get_catalog(current_user: dict = Depends(get_current_user)) -> ShelfCatalogResp:
    db = await get_supabase()
    me = await _mentor(db, current_user)
    lo, hi = await shelf_svc.price_limits(db)
    return ShelfCatalogResp(
        catalog=await _catalog(db),
        price_limits=PriceLimits(min=lo, max=hi),
        gift_balance=int(me.get("gift_balance") or 0),
        gift_freeze_balance=int(me.get("gift_freeze_balance") or 0),
    )


# ---------------------------------------------------------------------------
# GET /shelf/players/{player_id}/page — страница игрока (находка №9)
# ---------------------------------------------------------------------------

@router.get("/players/{player_id}/page", response_model=PlayerPageResp)
async def player_page(
    player_id: UUID, current_user: dict = Depends(get_current_user)
) -> PlayerPageResp:
    db = await get_supabase()
    me = await _mentor(db, current_user)
    partnership_id = await _pair(db, me["id"], str(player_id))

    u_res = await (
        db.table("users")
        .select("id, first_name, gender, goal, fitness_level, card_photo_url")
        .eq("id", str(player_id)).maybe_single().execute()
    )
    if not u_res or not u_res.data:
        raise HTTPException(status_code=404, detail={"code": "PLAYER_NOT_FOUND"})
    player = u_res.data

    st_res = await (
        db.table("player_stats")
        .select("global_score, current_streak, best_streak, last_workout_date")
        .eq("player_id", str(player_id)).maybe_single().execute()
    )
    stats = (st_res.data if (st_res and st_res.data) else {}) or {}

    items_res = await (
        db.table("shelf_items").select("*")
        .eq("partnership_id", partnership_id)
        .in_("status", ["active", "hidden", "purchased"])
        .order("created_at").execute()
    )
    rows = items_res.data or []
    shelf_rows = [r for r in rows if r["status"] in shelf_svc.OCCUPYING_STATUSES]
    pending_rows = [r for r in rows if r["status"] == "purchased"]

    lo, hi = await shelf_svc.price_limits(db)
    # NB: drops_balance игрока Ответственному не отдаём (§8.7).
    return PlayerPageResp(
        player_id=str(player_id),
        partnership_id=partnership_id,
        first_name=player.get("first_name"),
        card_photo_url=player.get("card_photo_url") or _cartoon(player.get("gender")),
        profile_line=shelf_svc.profile_line(player),
        gender=player.get("gender"),
        xp=int(stats.get("global_score") or 0),
        current_streak=int(stats.get("current_streak") or 0),
        best_streak=int(stats.get("best_streak") or 0),
        last_workout_date=stats.get("last_workout_date"),
        slots_used=len(shelf_rows),
        slots_total=shelf_svc.slots_for_tier(me.get("_tier")),
        shelf=[_item_out(r) for r in shelf_rows],
        pending=[_item_out(r) for r in pending_rows],
        reputation_drops=await shelf_svc.reputation_drops(db, partnership_id),
        pending_count=len(pending_rows),
        gift_balance=int(me.get("gift_balance") or 0),
        gift_freeze_balance=int(me.get("gift_freeze_balance") or 0),
        price_limits=PriceLimits(min=lo, max=hi),
        catalog=await _catalog(db),
    )


def _cartoon(gender: str | None) -> str:
    """Дефолт фото-карточки — мультяшка по полу (как в 8c, partnerships.py)."""
    return "/avatars/cartoon_female.svg" if gender == "female" else "/avatars/cartoon_male.svg"


# ---------------------------------------------------------------------------
# POST /shelf/promise — видео-обещание (§8.8a)
# ---------------------------------------------------------------------------

@router.post("/promise", response_model=ShelfItemOut)
async def create_promise(
    player_id: UUID = Form(...),
    title: str = Form(..., min_length=2, max_length=80),
    price_drops: int = Form(..., ge=1),
    video: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
) -> ShelfItemOut:
    """Обещание = видео ≤30 сек + название + цена в каплях. Гейт свободного слота
    по ЖИВОЙ подписке. Видео уходит в приватный бакет promises."""
    db = await get_supabase()
    me = await _mentor(db, current_user)
    partnership_id = await _pair(db, me["id"], str(player_id))

    lo, hi = await shelf_svc.price_limits(db)
    if not (lo <= price_drops <= hi):
        raise HTTPException(status_code=400, detail={"code": "PRICE_OUT_OF_LIMITS", "min": lo, "max": hi})

    total = shelf_svc.slots_for_tier(me.get("_tier"))
    used = await shelf_svc.used_slots(db, partnership_id)
    if used >= total:
        raise HTTPException(status_code=409, detail={"code": "NO_FREE_SLOT", "used": used, "total": total})

    payload = await video.read()
    if len(payload) == 0:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_VIDEO"})
    if len(payload) > shelf_svc.MAX_PROMISE_BYTES:
        raise HTTPException(status_code=413, detail={"code": "VIDEO_TOO_LARGE"})
    mime = video.content_type or "video/webm"
    if mime not in shelf_svc.PROMISE_MIMES:
        mime = "video/webm"

    path = shelf_svc.promise_path(partnership_id, "promise")
    try:
        await shelf_svc.upload_promise_video(db, path, payload, mime)
    except Exception as e:
        logger.error("[shelf] promise upload failed pair=%s: %s", partnership_id, e)
        raise HTTPException(status_code=500, detail={"code": "STORAGE_FAILED"})

    ins = await (
        db.table("shelf_items").insert({
            "partnership_id": partnership_id,
            "type": "promise",
            "title": title.strip(),
            "price_drops": price_drops,
            "status": "active",
            "video_path": path,
        }).execute()
    )
    if not ins.data:
        await shelf_svc.remove_promise_videos(db, [path])
        raise HTTPException(status_code=500, detail={"code": "CREATE_FAILED"})

    await _notify_player(
        db, str(player_id),
        type="shelf_new_item",
        title="🎁 Новое обещание на полке",
        message=f"«{title.strip()}» — {price_drops} 💧",
        payload={"item_id": str(ins.data[0]["id"]), "type": "promise"},
        bot_text=f"🎁 Наставник положил на полку обещание «{title.strip()}» за {price_drops} 💧.",
    )
    return _item_out(ins.data[0])


# ---------------------------------------------------------------------------
# POST /shelf/star-item — Stars-предмет (покупка = сразу выставление)
# ---------------------------------------------------------------------------

@router.post("/star-item", response_model=InvoiceResponse)
async def buy_star_item(
    body: StarItemReq, current_user: dict = Depends(get_current_user)
) -> InvoiceResponse:
    """R покупает предмет каталога за Stars и сразу выставляет его на полку игрока
    с собственной ценой в каплях. Инвентаря нет — лот создаётся в fulfill."""
    db = await get_supabase()
    me = await _mentor(db, current_user)
    partnership_id = await _pair(db, me["id"], str(body.player_id))

    lo, hi = await shelf_svc.price_limits(db)
    if not (lo <= body.price_drops <= hi):
        raise HTTPException(status_code=400, detail={"code": "PRICE_OUT_OF_LIMITS", "min": lo, "max": hi})

    total = shelf_svc.slots_for_tier(me.get("_tier"))
    used = await shelf_svc.used_slots(db, partnership_id)
    if used >= total:
        raise HTTPException(status_code=409, detail={"code": "NO_FREE_SLOT", "used": used, "total": total})

    cat_res = await (
        db.table("shelf_catalog").select("key, title, price_stars, is_active")
        .eq("key", body.catalog_key).eq("is_active", True).maybe_single().execute()
    )
    if not cat_res or not cat_res.data:
        raise HTTPException(status_code=400, detail={"code": "CATALOG_ITEM_UNAVAILABLE"})
    cat = cat_res.data

    payment_id, invoice_link = await create_stars_invoice(
        db,
        buyer_id=me["id"],
        product_type="shelf_star_item",
        title=cat["title"],
        description=f"Предмет на полку игрока. Игрок выкупит его за {body.price_drops} 💧.",
        price_stars=int(cat["price_stars"]),
        partnership_id=partnership_id,
        meta={
            "catalog_key": cat["key"],
            "title": cat["title"],
            "price_drops": body.price_drops,
            "player_id": str(body.player_id),
        },
    )
    return InvoiceResponse(payment_id=payment_id, invoice_link=invoice_link)


# ---------------------------------------------------------------------------
# PATCH / DELETE /shelf/items/{item_id}
# ---------------------------------------------------------------------------

@router.patch("/items/{item_id}", response_model=ShelfItemOut)
async def patch_item(
    item_id: UUID, body: PatchItemReq, current_user: dict = Depends(get_current_user)
) -> ShelfItemOut:
    """Цена и перевыставление. Скрытый игроком Stars-предмет возвращается на полку
    БЕЗ повторной оплаты Stars. Купленные лоты не трогаем."""
    db = await get_supabase()
    me = await _mentor(db, current_user)
    item = await _own_item(db, me["id"], str(item_id))
    if item["status"] not in shelf_svc.OCCUPYING_STATUSES:
        raise HTTPException(status_code=409, detail={"code": "ITEM_LOCKED", "status": item["status"]})

    update: dict = {}
    if body.price_drops is not None:
        lo, hi = await shelf_svc.price_limits(db)
        if not (lo <= body.price_drops <= hi):
            raise HTTPException(status_code=400, detail={"code": "PRICE_OUT_OF_LIMITS", "min": lo, "max": hi})
        update["price_drops"] = body.price_drops
    if body.status is not None:
        if body.status not in shelf_svc.OCCUPYING_STATUSES:
            raise HTTPException(status_code=400, detail={"code": "BAD_STATUS"})
        if body.status == "active" and item["status"] == "hidden":
            # Перевыставление занимает слот — он уже занят скрытым лотом, проверка не нужна.
            pass
        update["status"] = body.status
    if not update:
        raise HTTPException(status_code=400, detail={"code": "NOTHING_TO_UPDATE"})

    res = await db.table("shelf_items").update(update).eq("id", str(item_id)).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND"})

    if update.get("status") == "active" and item["status"] == "hidden":
        await _notify_player(
            db, str(item["_player_id"]),
            type="shelf_new_item",
            title="🎁 Наставник вернул лот на полку",
            message=f"«{item.get('title')}» — {update.get('price_drops', item['price_drops'])} 💧",
            payload={"item_id": str(item_id)},
        )
    return _item_out(res.data[0])


@router.delete("/items/{item_id}", response_model=OkResp)
async def delete_item(item_id: UUID, current_user: dict = Depends(get_current_user)) -> OkResp:
    """Убрать лот с полки (active/hidden). Купленное убрать нельзя — обещание
    остаётся к исполнению, споры решает админ (§8.8a п.7)."""
    db = await get_supabase()
    me = await _mentor(db, current_user)
    item = await _own_item(db, me["id"], str(item_id))
    if item["status"] not in shelf_svc.OCCUPYING_STATUSES:
        raise HTTPException(status_code=409, detail={"code": "ITEM_LOCKED", "status": item["status"]})

    await db.table("shelf_items").delete().eq("id", str(item_id)).execute()
    await shelf_svc.remove_promise_videos(db, [item.get("video_path")])
    return OkResp()


# ---------------------------------------------------------------------------
# POST /shelf/gift-drops — дарение капель (RPC)
# ---------------------------------------------------------------------------

@router.post("/gift-drops", response_model=GiftDropsResp)
async def gift_drops(
    body: GiftDropsReq, current_user: dict = Depends(get_current_user)
) -> GiftDropsResp:
    """Перевод из gift_balance R в drops_balance игрока. Кап дарения не вводим (§8.7)."""
    db = await get_supabase()
    me = await _mentor(db, current_user)
    await _pair(db, me["id"], str(body.player_id))

    res = await db.rpc("gift_drops", {
        "p_responsible_id": me["id"],
        "p_player_id": str(body.player_id),
        "p_amount": body.amount,
    }).execute()
    data = res.data if isinstance(res.data, dict) else {}
    if not data.get("ok"):
        code = data.get("code") or "GIFT_FAILED"
        if code == "INSUFFICIENT_GIFT_BALANCE":
            raise HTTPException(status_code=400, detail={
                "code": code, "gift_balance": int(data.get("gift_balance") or 0), "amount": body.amount,
            })
        raise HTTPException(status_code=409, detail={"code": code})

    await _notify_player(
        db, str(body.player_id),
        type="drops_gift",
        title="💧 Подарок от наставника",
        message=f"+{body.amount} капель на баланс",
        payload={"amount": body.amount, "from_user_id": me["id"]},
        bot_text=f"💧 Наставник подарил тебе {body.amount} капель!",
    )
    return GiftDropsResp(gifted=body.amount, gift_balance=int(data.get("gift_balance") or 0))


# ---------------------------------------------------------------------------
# GET /shelf/items/{item_id}/video-url — подписанная ссылка (доступ только паре)
# ---------------------------------------------------------------------------

@router.get("/items/{item_id}/video-url", response_model=VideoUrlResp)
async def item_video_url(
    item_id: UUID,
    kind: str = "promise",
    current_user: dict = Depends(get_current_user),
) -> VideoUrlResp:
    """kind='promise' — видео обещания, 'report' — видеоотчёт игрока.
    Ссылка выдаётся только Ответственному или Игроку этой пары (§8.8a п.8)."""
    if kind not in ("promise", "report"):
        raise HTTPException(status_code=400, detail={"code": "BAD_KIND"})

    db = await get_supabase()
    me_res = await (
        db.table("users").select("id").eq("telegram_id", current_user["telegram_id"])
        .maybe_single().execute()
    )
    if not me_res or not me_res.data:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})
    me_id = me_res.data["id"]

    item_res = await (
        db.table("shelf_items").select("id, partnership_id, video_path, report_video_path")
        .eq("id", str(item_id)).maybe_single().execute()
    )
    if not item_res or not item_res.data:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND"})
    item = item_res.data

    pair_res = await (
        db.table("partnerships").select("responsible_id, player_id")
        .eq("id", item["partnership_id"]).maybe_single().execute()
    )
    pair = pair_res.data if (pair_res and pair_res.data) else {}
    if me_id not in (pair.get("responsible_id"), pair.get("player_id")):
        raise HTTPException(status_code=403, detail={"code": "NOT_YOUR_ITEM"})

    path = item.get("video_path") if kind == "promise" else item.get("report_video_path")
    url = await shelf_svc.signed_video_url(db, path)
    if not url:
        raise HTTPException(status_code=404, detail={"code": "VIDEO_UNAVAILABLE"})
    return VideoUrlResp(url=url, expires_in=shelf_svc.SIGNED_URL_TTL_SEC)

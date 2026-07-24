"""Player shop API (Phase 8c) — витрина игрока за капли 💧.

Покупки:
  * POST /players/me/buy-freeze      — докупка заморозки (кап запаса 3), RPC-атомарно.
  * POST /players/me/restore-streak  — восстановление сломанного стрика (окно 72ч),
    цена = streak_restore.price × lost_streak_len, зажатая в [meta.min, meta.cap].
  * Фото-карточка (8.8b): purchase → upload (ai|raw) → choose | reroll.
GET /players/me/shop — агрегат витрины: баланс, цены, счётчики, состояние
фото-карточки, restore-офер.
"""
import asyncio
import base64
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...core.config import settings
from ...core.deps import get_current_user
from ...db.client import get_supabase
from ...services.photo_styler import process_card_photo_variants

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/players", tags=["players"])

UTC = timezone.utc

# Окно платного restore после слома стрика (допущение 8c; при желании — в админку).
STREAK_RESTORE_WINDOW_HOURS = 72

# Дефолтный зажим цены restore, если meta не заполнена в app_shop_items.
RESTORE_MIN_DEFAULT = 60
RESTORE_CAP_DEFAULT = 400

MAX_SELFIE_BYTES = 5 * 1024 * 1024


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CardPhotoState(BaseModel):
    url: str | None = None
    source: str | None = None            # 'ai' | 'raw'
    status: str | None = None            # None | awaiting_photo | processing | choosing | failed
    variants: list[str] = []


class RestoreOffer(BaseModel):
    lost_streak_len: int
    lost_streak_at: str
    price: int
    expires_at: str                      # конец 72ч-окна


class PlayerShopState(BaseModel):
    drops_balance: int
    prices: dict[str, int]               # key → price_drops (только активные позиции)
    free_freezes_left: int
    paid_freezes: int
    paid_freezes_cap: int = 3
    restore: RestoreOffer | None = None
    card_photo: CardPhotoState


class BuyFreezeResp(BaseModel):
    drops_balance: int
    paid_freezes: int


class RestoreStreakResp(BaseModel):
    drops_balance: int
    current_streak: int


class CardUploadReq(BaseModel):
    photo_base64: str
    mode: Literal["ai", "raw"]


class CardChooseReq(BaseModel):
    index: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _me(db, telegram_id: int) -> dict:
    res = await (
        db.table("users")
        .select("id, telegram_id, gender, has_player_access, "
                "card_photo_url, card_photo_source, card_photo_candidates")
        .eq("telegram_id", telegram_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})
    if not res.data.get("has_player_access"):
        raise HTTPException(status_code=403, detail={"code": "PLAYERS_ONLY"})
    return res.data


async def _prices(db) -> dict[str, dict]:
    res = await (
        db.table("app_shop_items")
        .select("key, price_drops, is_active, meta")
        .execute()
    )
    return {r["key"]: r for r in (res.data or [])}


def _price_of(prices: dict[str, dict], key: str) -> int:
    row = prices.get(key)
    if not row or not row.get("is_active"):
        raise HTTPException(status_code=500, detail={"code": "PRICE_NOT_CONFIGURED", "key": key})
    return int(row["price_drops"])


def _restore_price(prices: dict[str, dict], lost_len: int) -> int:
    """streak_restore.price × дней, зажатая в [meta.min, meta.cap]."""
    unit = _price_of(prices, "streak_restore")
    row = prices.get("streak_restore") or {}
    meta = row.get("meta") or {}
    lo = int(meta.get("min") or RESTORE_MIN_DEFAULT)
    hi = int(meta.get("cap") or RESTORE_CAP_DEFAULT)
    return max(lo, min(unit * lost_len, hi))


def _parse_dt(v) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


async def _charge_drops(db, player_id: str, price: int) -> int:
    """Оптимистичное списание (compare-and-set, 2 попытки). Возвращает новый баланс."""
    for _ in range(2):
        ps = await (
            db.table("player_stats").select("drops_balance")
            .eq("player_id", player_id).maybe_single().execute()
        )
        bal = int((ps.data or {}).get("drops_balance") or 0) if ps else 0
        if bal < price:
            raise HTTPException(
                status_code=400,
                detail={"code": "INSUFFICIENT_DROPS", "balance": bal, "price": price},
            )
        upd = await (
            db.table("player_stats").update({"drops_balance": bal - price})
            .eq("player_id", player_id).eq("drops_balance", bal).execute()
        )
        if upd.data:
            return bal - price
    raise HTTPException(status_code=409, detail={"code": "RACE"})


async def _refund_drops(db, player_id: str, amount: int) -> None:
    """Возврат капель (best-effort, 3 попытки CAS)."""
    for _ in range(3):
        ps = await (
            db.table("player_stats").select("drops_balance")
            .eq("player_id", player_id).maybe_single().execute()
        )
        bal = int((ps.data or {}).get("drops_balance") or 0) if ps else 0
        upd = await (
            db.table("player_stats").update({"drops_balance": bal + amount})
            .eq("player_id", player_id).eq("drops_balance", bal).execute()
        )
        if upd.data:
            return
    logger.critical("drops refund FAILED player=%s amount=%s", player_id, amount)


def _decode_selfie(photo_base64: str) -> bytes:
    raw = photo_base64
    if "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        data = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "BAD_BASE64"})
    if len(data) == 0:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_PHOTO"})
    if len(data) > MAX_SELFIE_BYTES:
        raise HTTPException(status_code=400, detail={"code": "PHOTO_TOO_LARGE"})
    return data


def _storage_base() -> str:
    return settings.SUPABASE_URL.strip().strip("'").strip('"').rstrip("/")


def _card_state(user_row: dict) -> CardPhotoState:
    cand = user_row.get("card_photo_candidates") or {}
    return CardPhotoState(
        url=user_row.get("card_photo_url"),
        source=user_row.get("card_photo_source"),
        status=cand.get("status"),
        variants=list(cand.get("variants") or []),
    )


def _restore_offer(stats: dict, prices: dict[str, dict]) -> RestoreOffer | None:
    lost_len = int(stats.get("lost_streak_len") or 0)
    lost_at = _parse_dt(stats.get("lost_streak_at"))
    if lost_len <= 0 or lost_at is None:
        return None
    deadline = lost_at + timedelta(hours=STREAK_RESTORE_WINDOW_HOURS)
    if datetime.now(UTC) >= deadline:
        return None
    try:
        price = _restore_price(prices, lost_len)
    except HTTPException:
        return None  # позиция выключена в админке → офер не показываем
    return RestoreOffer(
        lost_streak_len=lost_len,
        lost_streak_at=lost_at.isoformat(),
        price=price,
        expires_at=deadline.isoformat(),
    )


# ---------------------------------------------------------------------------
# GET /players/me/shop — агрегат витрины
# ---------------------------------------------------------------------------

@router.get("/me/shop", response_model=PlayerShopState)
async def get_shop_state(current_user: dict = Depends(get_current_user)) -> PlayerShopState:
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    prices = await _prices(db)

    ps = await (
        db.table("player_stats")
        .select("drops_balance, free_freezes_left, paid_freezes, lost_streak_len, lost_streak_at")
        .eq("player_id", me["id"]).maybe_single().execute()
    )
    stats = ps.data if (ps and ps.data) else {}

    return PlayerShopState(
        drops_balance=int(stats.get("drops_balance") or 0),
        prices={k: int(r["price_drops"]) for k, r in prices.items() if r.get("is_active")},
        free_freezes_left=int(stats.get("free_freezes_left") or 0),
        paid_freezes=int(stats.get("paid_freezes") or 0),
        restore=_restore_offer(stats, prices),
        card_photo=_card_state(me),
    )


# ---------------------------------------------------------------------------
# POST /players/me/buy-freeze
# ---------------------------------------------------------------------------

@router.post("/me/buy-freeze", response_model=BuyFreezeResp)
async def buy_freeze(current_user: dict = Depends(get_current_user)) -> BuyFreezeResp:
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    prices = await _prices(db)
    price = _price_of(prices, "freeze")

    # Атомарно: баланс и кап проверяются в одном UPDATE (RPC 036b).
    res = await db.rpc("buy_paid_freeze", {"p_player_id": me["id"], "p_price": price}).execute()
    data = res.data if isinstance(res.data, dict) else {}
    if not data.get("ok"):
        paid = int(data.get("paid_freezes") or 0)
        bal = int(data.get("balance") or 0)
        if paid >= 3:
            raise HTTPException(status_code=400, detail={"code": "FREEZE_CAP", "paid_freezes": paid})
        raise HTTPException(
            status_code=400,
            detail={"code": "INSUFFICIENT_DROPS", "balance": bal, "price": price},
        )
    return BuyFreezeResp(
        drops_balance=int(data.get("balance") or 0),
        paid_freezes=int(data.get("paid_freezes") or 0),
    )


# ---------------------------------------------------------------------------
# POST /players/me/restore-streak
# ---------------------------------------------------------------------------

@router.post("/me/restore-streak", response_model=RestoreStreakResp)
async def restore_streak(current_user: dict = Depends(get_current_user)) -> RestoreStreakResp:
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    prices = await _prices(db)

    ps = await (
        db.table("player_stats")
        .select("drops_balance, lost_streak_len, lost_streak_at")
        .eq("player_id", me["id"]).maybe_single().execute()
    )
    stats = ps.data if (ps and ps.data) else {}
    offer = _restore_offer(stats, prices)
    if offer is None:
        raise HTTPException(status_code=409, detail={"code": "NO_RESTORE_AVAILABLE"})

    res = await db.rpc("restore_streak", {
        "p_player_id": me["id"],
        "p_price": offer.price,
        "p_expected_len": offer.lost_streak_len,
        "p_max_age_hours": STREAK_RESTORE_WINDOW_HOURS,
    }).execute()
    data = res.data if isinstance(res.data, dict) else {}
    if not data.get("ok"):
        bal = int(data.get("balance") or 0)
        if bal < offer.price:
            raise HTTPException(
                status_code=400,
                detail={"code": "INSUFFICIENT_DROPS", "balance": bal, "price": offer.price},
            )
        raise HTTPException(status_code=409, detail={"code": "NO_RESTORE_AVAILABLE"})
    return RestoreStreakResp(
        drops_balance=int(data.get("balance") or 0),
        current_streak=int(data.get("current_streak") or 0),
    )


# ---------------------------------------------------------------------------
# Фото-карточка (8.8b): purchase → upload (ai|raw) → choose | reroll
# ---------------------------------------------------------------------------

@router.post("/me/card-photo/purchase", response_model=CardPhotoState)
async def card_photo_purchase(current_user: dict = Depends(get_current_user)) -> CardPhotoState:
    """Покупка «Своё фото на карточке». Повторная смена позже — снова полная цена."""
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    cand = me.get("card_photo_candidates") or {}
    if cand.get("status") in ("awaiting_photo", "processing", "choosing"):
        raise HTTPException(status_code=409, detail={"code": "CARD_FLOW_PENDING"})

    prices = await _prices(db)
    price = _price_of(prices, "photo_card")
    await _charge_drops(db, me["id"], price)

    new_cand = {"status": "awaiting_photo"}
    await (
        db.table("users").update({"card_photo_candidates": new_cand})
        .eq("id", me["id"]).execute()
    )
    return _card_state({**me, "card_photo_candidates": new_cand})


@router.post("/me/card-photo/upload", response_model=CardPhotoState)
async def card_photo_upload(
    body: CardUploadReq, current_user: dict = Depends(get_current_user)
) -> CardPhotoState:
    """Селфи после покупки. mode='ai' → 2 варианта фоном; mode='raw' → сразу карточка
    (в AI не отправляется)."""
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    cand = me.get("card_photo_candidates") or {}
    if cand.get("status") not in ("awaiting_photo", "failed"):
        raise HTTPException(status_code=409, detail={"code": "NOT_AWAITING_PHOTO"})

    photo_bytes = _decode_selfie(body.photo_base64)
    tid = me["telegram_id"]
    base = _storage_base()

    if body.mode == "raw":
        path = f"{tid}/card_raw_{uuid.uuid4().hex[:8]}.jpg"
        try:
            await db.storage.from_("avatars").upload(
                path=path,
                file=photo_bytes,
                file_options={"content-type": "image/jpeg", "x-upsert": "true"},
            )
        except Exception as e:
            logger.error("card raw upload failed for %s: %s", tid, e)
            raise HTTPException(status_code=500, detail={"code": "STORAGE_FAILED"})
        url = f"{base}/storage/v1/object/public/avatars/{path}"
        update = {
            "card_photo_url": url,
            "card_photo_source": "raw",
            "card_photo_candidates": None,
        }
        await db.table("users").update(update).eq("id", me["id"]).execute()
        return _card_state({**me, **update})

    # mode == 'ai': селфи сохраняем (нужно для reroll), генерация фоном.
    try:
        await db.storage.from_("avatars").upload(
            path=f"{tid}/card_selfie.jpg",
            file=photo_bytes,
            file_options={"content-type": "image/jpeg", "x-upsert": "true"},
        )
    except Exception as e:
        logger.warning("card selfie store failed (reroll недоступен): %s", e)

    new_cand = {"status": "processing"}
    await (
        db.table("users").update({"card_photo_candidates": new_cand})
        .eq("id", me["id"]).execute()
    )
    asyncio.create_task(process_card_photo_variants(photo_bytes, tid, me.get("gender")))
    return _card_state({**me, "card_photo_candidates": new_cand})


@router.post("/me/card-photo/choose", response_model=CardPhotoState)
async def card_photo_choose(
    body: CardChooseReq, current_user: dict = Depends(get_current_user)
) -> CardPhotoState:
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    cand = me.get("card_photo_candidates") or {}
    variants = list(cand.get("variants") or [])
    if cand.get("status") != "choosing" or not variants:
        raise HTTPException(status_code=409, detail={"code": "NOT_CHOOSING"})
    if not (0 <= body.index < len(variants)):
        raise HTTPException(status_code=422, detail={"code": "BAD_INDEX"})

    update = {
        "card_photo_url": variants[body.index],
        "card_photo_source": "ai",
        "card_photo_candidates": None,
    }
    await db.table("users").update(update).eq("id", me["id"]).execute()
    return _card_state({**me, **update})


@router.post("/me/card-photo/reroll", response_model=CardPhotoState)
async def card_photo_reroll(current_user: dict = Depends(get_current_user)) -> CardPhotoState:
    """Списание photo_reroll → 2 новых варианта взамен (из сохранённого селфи)."""
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    cand = me.get("card_photo_candidates") or {}
    if cand.get("status") != "choosing":
        raise HTTPException(status_code=409, detail={"code": "NOT_CHOOSING"})

    tid = me["telegram_id"]
    try:
        selfie = await db.storage.from_("avatars").download(f"{tid}/card_selfie.jpg")
    except Exception:
        selfie = None
    if not selfie:
        raise HTTPException(status_code=409, detail={"code": "SELFIE_MISSING"})

    prices = await _prices(db)
    price = _price_of(prices, "photo_reroll")
    await _charge_drops(db, me["id"], price)

    new_cand = {"status": "processing"}
    upd = await (
        db.table("users").update({"card_photo_candidates": new_cand})
        .eq("id", me["id"]).execute()
    )
    if not upd.data:
        await _refund_drops(db, me["id"], price)
        raise HTTPException(status_code=409, detail={"code": "RACE"})
    asyncio.create_task(process_card_photo_variants(selfie, tid, me.get("gender")))
    return _card_state({**me, "card_photo_candidates": new_cand})

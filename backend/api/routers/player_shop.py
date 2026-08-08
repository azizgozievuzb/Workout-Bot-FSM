"""Player shop API (Phase 8c) — витрина игрока за капли 💧.

Покупки:
  * POST /players/me/buy-freeze      — докупка заморозки (кап запаса 3), RPC-атомарно.
  * POST /players/me/restore-streak  — восстановление сломанного стрика (окно 72ч),
    цена = streak_restore.price × lost_streak_len, зажатая в [meta.min, meta.cap].
  * Фото-карточка (8.8b): purchase → upload (ai|raw) → choose | reroll.
  * Полка наставника (8d): buy / fulfill / hide лотов своей пары.
GET /players/me/shop — агрегат витрины: баланс, цены, счётчики, состояние
фото-карточки, restore-офер, полка наставника и «Мои покупки».
"""
import asyncio
import base64
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ...core.config import settings
from ...core.deps import get_bot, get_current_user
from ...db.client import get_supabase
from ...services import shelf as shelf_svc
from ...services.bot_notify import send_bot_message
from ...services.notifications import emit_notification
from ...services.photo_styler import process_card_photo_variants

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/players", tags=["players"])

UTC = timezone.utc

# Окно платного restore после слома стрика (допущение 8c; при желании — в админку).
STREAK_RESTORE_WINDOW_HOURS = 72

# Дефолтный зажим цены restore, если meta не заполнена в app_shop_items.
RESTORE_MIN_DEFAULT = 60
RESTORE_CAP_DEFAULT = 400

# 8c.1: прогрессирующие цены фото-карточки (дефолты, если meta пуста).
# AI-смена №k = photo_card × mult^(k-1) (кап), реролл №m = photo_reroll × mult^(m-1) (кап);
# raw-смена — всегда фикс. mult/cap — админ-редактируемые (app_shop_items.meta).
PHOTO_MULT_DEFAULT = 2
PHOTO_CARD_CAP_DEFAULT = 3200
PHOTO_REROLL_CAP_DEFAULT = 960

MAX_SELFIE_BYTES = 5 * 1024 * 1024

# 8d.1 (Д7): «оставить как есть» на экране выбора вариантов.
KEEP_ORIGINAL_INDEX = -1


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CardPhotoState(BaseModel):
    url: str | None = None
    source: str | None = None            # 'ai' | 'raw'
    status: str | None = None            # None | awaiting_photo | processing | choosing | failed
    mode: str | None = None              # режим текущего флоу ('ai'|'raw'), фиксируется при покупке
    variants: list[str] = []
    # 8d.1 (П.10): чем сделан variants[i] — 'weak' | 'deep'; фронт рисует подписи.
    variant_modes: list[str] = []
    # Оригинал селфи — показывается рядом с вариантами на экране выбора.
    selfie_url: str | None = None


class RestoreOffer(BaseModel):
    lost_streak_len: int
    lost_streak_at: str
    price: int
    expires_at: str                      # конец 72ч-окна


class ShelfItemOut(BaseModel):
    """Лот полки наставника глазами игрока (8d)."""
    id: str
    type: str                            # 'promise' | 'star_item'
    title: str
    price_drops: int
    status: str
    star_catalog_key: str | None = None
    has_video: bool = False
    has_report: bool = False
    created_at: str | None = None
    purchased_at: str | None = None
    fulfilled_at: str | None = None


class PlayerShopState(BaseModel):
    drops_balance: int
    prices: dict[str, int]               # key → price_drops (только активные позиции)
    free_freezes_left: int
    paid_freezes: int
    paid_freezes_cap: int = shelf_svc.PAID_FREEZE_CAP
    restore: RestoreOffer | None = None
    card_photo: CardPhotoState
    # 8c.1: актуальные для юзера цены фото-карточки (прогрессия по счётчикам).
    photo_card_ai_price: int | None = None
    photo_card_raw_price: int | None = None
    photo_reroll_price: int | None = None
    # 8d: подаренные рероллы (тратятся вне прогрессии цен) + полка наставника.
    reroll_credits: int = 0
    shelf: list[ShelfItemOut] = []
    my_purchases: list[ShelfItemOut] = []
    # 8d.1 (П.7, находка №23): секция полки видна ВСЕГДА при живом партнёрстве —
    # пустые слоты рисуются заглушками, поэтому фронту нужно их число.
    has_mentor: bool = False
    shelf_slots_total: int = 0


class ShelfBuyResp(BaseModel):
    drops_balance: int
    status: str
    paid_freezes: int | None = None
    reroll_credits: int | None = None


class BuyFreezeResp(BaseModel):
    drops_balance: int
    paid_freezes: int


class RestoreStreakResp(BaseModel):
    drops_balance: int
    current_streak: int


class CardUploadReq(BaseModel):
    photo_base64: str
    mode: Literal["ai", "raw"]


class CardPurchaseReq(BaseModel):
    mode: Literal["ai", "raw"] = "ai"


class CardChooseReq(BaseModel):
    # index >= 0 — AI-вариант; index == KEEP_ORIGINAL_INDEX — «оставить как есть»
    # (8d.1 Д7): карточкой становится исходное селфи, без AI.
    index: int = Field(ge=-1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _me(db, telegram_id: int) -> dict:
    res = await (
        db.table("users")
        .select("id, telegram_id, gender, has_player_access, "
                "card_photo_url, card_photo_source, card_photo_candidates, "
                "card_ai_changes, card_rerolls")
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


def _progressive_price(prices: dict[str, dict], key: str, count: int, cap_default: int) -> int:
    """Цена №(count+1)-й операции: base × mult^count, зажатая капом (8c.1)."""
    base = _price_of(prices, key)
    meta = (prices.get(key) or {}).get("meta") or {}
    mult = int(meta.get("mult") or PHOTO_MULT_DEFAULT)
    cap = int(meta.get("cap") or cap_default)
    return min(base * (mult ** max(0, count)), cap)


def _parse_dt(v) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


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
        mode=cand.get("mode"),
        variants=list(cand.get("variants") or []),
        variant_modes=list(cand.get("modes") or []),
        selfie_url=cand.get("selfie_url"),
    )


def _selfie_public_url(telegram_id: int, cache_token: str) -> str:
    """Публичная ссылка на исходное селфи. Путь фиксированный и перезаписывается
    каждым новым флоу — поэтому к нему прибит токен, иначе экран выбора показал бы
    закешированный оригинал прошлой попытки."""
    return (f"{_storage_base()}/storage/v1/object/public/avatars/"
            f"{telegram_id}/card_selfie.jpg?v={cache_token}")


def _shelf_out(row: dict) -> ShelfItemOut:
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


async def _my_pair(db, player_id: str) -> dict | None:
    """Живая пара игрока: {id, responsible_id} или None."""
    res = await (
        db.table("partnerships").select("id, responsible_id")
        .eq("player_id", player_id).eq("status", "active")
        .limit(1).execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


async def _my_partnership(db, player_id: str) -> str | None:
    pair = await _my_pair(db, player_id)
    return str(pair["id"]) if pair else None


async def _mentor_shelf_slots(db, responsible_id: str | None) -> int:
    """Сколько слотов на полке даёт ЖИВОЙ тариф наставника (std 2 / prm 4 / elt 6).
    Нужно игроку, чтобы нарисовать пустые ячейки полки (8d.1 П.7)."""
    if not responsible_id:
        return 0
    res = await (
        db.table("users").select("responsible_access_tier")
        .eq("id", responsible_id).maybe_single().execute()
    )
    row = res.data if (res and res.data) else {}
    return shelf_svc.slots_for_tier((row or {}).get("responsible_access_tier"))


async def _my_shelf_item(db, player_id: str, item_id: str) -> dict:
    """Лот, принадлежащий живой паре ЭТОГО игрока."""
    partnership_id = await _my_partnership(db, player_id)
    if not partnership_id:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND"})
    res = await (
        db.table("shelf_items").select("*")
        .eq("id", item_id).eq("partnership_id", partnership_id)
        .maybe_single().execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND"})
    item = res.data
    item["_partnership_id"] = partnership_id
    return item


async def _store_report_video(db, partnership_id: str, video: UploadFile | None) -> str | None:
    """Видеоотчёт игрока в приватный бакет. None — файла нет/он пустой."""
    if video is None:
        return None
    payload = await video.read()
    if len(payload) > shelf_svc.MAX_PROMISE_BYTES:
        raise HTTPException(status_code=413, detail={"code": "VIDEO_TOO_LARGE"})
    if not payload:
        return None
    mime = shelf_svc.normalize_mime(video.content_type)
    path = shelf_svc.promise_path(partnership_id, "report", mime)
    try:
        await shelf_svc.upload_promise_video(db, path, payload, mime)
    except Exception as e:
        logger.error("[shelf] report upload failed pair=%s: %s", partnership_id, e)
        raise HTTPException(status_code=500, detail={"code": "STORAGE_FAILED"})
    return path


async def _notify_mentor(db, partnership_id: str, *, type: str, title: str,
                         message: str, payload: dict | None = None,
                         bot_text: str | None = None) -> None:
    pair = await (
        db.table("partnerships").select("responsible_id")
        .eq("id", partnership_id).maybe_single().execute()
    )
    resp_id = pair.data.get("responsible_id") if (pair and pair.data) else None
    if not resp_id:
        return
    await emit_notification(db, user_id=resp_id, type=type, title=title,
                            message=message, payload=payload or {})
    if not bot_text:
        return
    try:
        tg = await (
            db.table("users").select("telegram_id").eq("id", resp_id).maybe_single().execute()
        )
        if tg and tg.data and tg.data.get("telegram_id"):
            await send_bot_message(get_bot(), int(tg.data["telegram_id"]), bot_text)
    except Exception as e:
        logger.info("[shelf] mentor notify skipped pair=%s: %s", partnership_id, e)


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
        .select("drops_balance, free_freezes_left, paid_freezes, reroll_credits, "
                "lost_streak_len, lost_streak_at")
        .eq("player_id", me["id"]).maybe_single().execute()
    )
    stats = ps.data if (ps and ps.data) else {}

    # 8d: полка наставника — активные лоты пары + «Мои покупки».
    shelf_rows: list[dict] = []
    purchase_rows: list[dict] = []
    pair = await _my_pair(db, me["id"])
    partnership_id = str(pair["id"]) if pair else None
    slots_total = await _mentor_shelf_slots(db, pair.get("responsible_id") if pair else None)
    if partnership_id:
        sh = await (
            db.table("shelf_items").select("*")
            .eq("partnership_id", partnership_id)
            .in_("status", ["active", "purchased", "fulfilled", "archived"])
            .order("created_at").execute()
        )
        for r in (sh.data or []):
            if r["status"] == "active":
                shelf_rows.append(r)
            else:
                purchase_rows.append(r)
        purchase_rows.sort(key=lambda r: str(r.get("purchased_at") or ""), reverse=True)

    def _safe(fn):
        try:
            return fn()
        except HTTPException:
            return None  # позиция выключена в админке

    return PlayerShopState(
        drops_balance=int(stats.get("drops_balance") or 0),
        prices={k: int(r["price_drops"]) for k, r in prices.items() if r.get("is_active")},
        free_freezes_left=int(stats.get("free_freezes_left") or 0),
        paid_freezes=int(stats.get("paid_freezes") or 0),
        restore=_restore_offer(stats, prices),
        card_photo=_card_state(me),
        photo_card_ai_price=_safe(lambda: _progressive_price(
            prices, "photo_card", int(me.get("card_ai_changes") or 0), PHOTO_CARD_CAP_DEFAULT)),
        photo_card_raw_price=_safe(lambda: _price_of(prices, "photo_card")),
        photo_reroll_price=_safe(lambda: _progressive_price(
            prices, "photo_reroll", int(me.get("card_rerolls") or 0), PHOTO_REROLL_CAP_DEFAULT)),
        reroll_credits=int(stats.get("reroll_credits") or 0),
        shelf=[_shelf_out(r) for r in shelf_rows],
        my_purchases=[_shelf_out(r) for r in purchase_rows],
        has_mentor=partnership_id is not None,
        shelf_slots_total=slots_total,
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
# Полка наставника (8d): buy → fulfill | hide
# ---------------------------------------------------------------------------

@router.post("/me/shelf/{item_id}/buy", response_model=ShelfBuyResp)
async def buy_shelf_item(
    item_id: uuid.UUID, current_user: dict = Depends(get_current_user)
) -> ShelfBuyResp:
    """Покупка лота полки за капли. Всё одной транзакцией (RPC 038): гейт
    status='active', кап заморозок ДО списания, эффект star_item, смена статуса.
    Обещание → 'purchased' (у наставника «к исполнению»), Stars-предмет → 'fulfilled'."""
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])

    res = await db.rpc("buy_shelf_item", {
        "p_player_id": me["id"], "p_item_id": str(item_id),
    }).execute()
    data = res.data if isinstance(res.data, dict) else {}
    if not data.get("ok"):
        code = data.get("code") or "ITEM_NOT_FOUND"
        if code == "INSUFFICIENT_DROPS":
            raise HTTPException(status_code=400, detail={
                "code": code,
                "balance": int(data.get("balance") or 0),
                "price": int(data.get("price") or 0),
            })
        if code == "FREEZE_CAP":
            raise HTTPException(status_code=400, detail={
                "code": code, "paid_freezes": int(data.get("paid_freezes") or 0),
            })
        if code == "ITEM_NOT_FOUND":
            raise HTTPException(status_code=404, detail={"code": code})
        # Гейты лотов ядра v1 (039b): отказ ДО списания — капли целы.
        if code in ("NO_ACTIVE_COOLDOWN", "LIGHT_TRIAL_UNAVAILABLE", "TITLE_TEXT_MISSING"):
            raise HTTPException(status_code=409, detail={"code": code})
        raise HTTPException(status_code=409, detail={"code": code, "status": data.get("status")})

    # Свежие счётчики (эффект star_item уже применён внутри RPC).
    fresh = await (
        db.table("player_stats").select("paid_freezes, reroll_credits")
        .eq("player_id", me["id"]).maybe_single().execute()
    )
    f = (fresh.data if (fresh and fresh.data) else {}) or {}

    item = await _my_shelf_item(db, me["id"], str(item_id))
    if data.get("type") == "promise":
        await _notify_mentor(
            db, item["_partnership_id"],
            type="promise_purchased",
            title="⏳ Обещание выкуплено",
            message=f"«{item.get('title')}» — {item.get('price_drops')} 💧. Ждёт исполнения.",
            payload={"item_id": str(item_id)},
            bot_text=(f"⏳ Игрок выкупил твоё обещание «{item.get('title')}» "
                      f"за {item.get('price_drops')} 💧. Пора исполнять!"),
        )
    else:
        await _notify_mentor(
            db, item["_partnership_id"],
            type="shelf_item_bought",
            title="🛒 Предмет с полки куплен",
            message=f"«{item.get('title')}» — {item.get('price_drops')} 💧",
            payload={"item_id": str(item_id)},
        )

    return ShelfBuyResp(
        drops_balance=int(data.get("balance") or 0),
        status=str(data.get("status") or ""),
        paid_freezes=int(f.get("paid_freezes") or 0),
        reroll_credits=int(f.get("reroll_credits") or 0),
    )


@router.post("/me/shelf/{item_id}/fulfill", response_model=ShelfItemOut)
async def fulfill_shelf_item(
    item_id: uuid.UUID,
    video: UploadFile | None = File(default=None),
    current_user: dict = Depends(get_current_user),
) -> ShelfItemOut:
    """Галочку «Выполнено» ставит ИГРОК (§8.8a п.5); видеоотчёт — опционально.
    Авто-возврата нет: вечный pending давит на наставника, споры — админ вручную."""
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    item = await _my_shelf_item(db, me["id"], str(item_id))
    if item["status"] != "purchased":
        raise HTTPException(status_code=409, detail={"code": "NOT_PENDING", "status": item["status"]})

    update: dict = {"status": "fulfilled", "fulfilled_at": datetime.now(UTC).isoformat()}

    path = await _store_report_video(db, item["_partnership_id"], video)
    if path:
        update["report_video_path"] = path

    res = await (
        db.table("shelf_items").update(update)
        .eq("id", str(item_id)).eq("status", "purchased").execute()
    )
    if not res.data:
        raise HTTPException(status_code=409, detail={"code": "NOT_PENDING"})

    await _notify_mentor(
        db, item["_partnership_id"],
        type="promise_fulfilled",
        title="✅ Обещание исполнено",
        message=f"Игрок отметил «{item.get('title')}» выполненным.",
        payload={"item_id": str(item_id), "has_report": bool(update.get("report_video_path"))},
        bot_text=f"✅ Игрок отметил обещание «{item.get('title')}» выполненным. Спасибо!",
    )
    return _shelf_out(res.data[0])


@router.post("/me/shelf/{item_id}/report", response_model=ShelfItemOut)
async def attach_shelf_report(
    item_id: uuid.UUID,
    video: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
) -> ShelfItemOut:
    """8d.1 (П.8c, Д6): видеоотчёт ПОСЛЕ галочки.

    Раньше отчёт принимался только вместе с `/fulfill` — игрок, отметивший
    обещание без видео, приложить его уже не мог. Гейты: лот принадлежит живой
    паре игрока, `status='fulfilled'`, отчёта ещё нет, тип — обещание.
    Репутация наставника считается по исполненным обещаниям и здесь НЕ растёт:
    статус лота не меняется, повторного начисления нет.
    """
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    item = await _my_shelf_item(db, me["id"], str(item_id))
    if item.get("type") != "promise":
        raise HTTPException(status_code=409, detail={"code": "NOT_A_PROMISE"})
    if item["status"] != "fulfilled":
        raise HTTPException(status_code=409, detail={"code": "NOT_FULFILLED", "status": item["status"]})
    if item.get("report_video_path"):
        raise HTTPException(status_code=409, detail={"code": "REPORT_EXISTS"})

    path = await _store_report_video(db, item["_partnership_id"], video)
    if not path:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_VIDEO"})

    res = await (
        db.table("shelf_items").update({"report_video_path": path})
        .eq("id", str(item_id)).eq("status", "fulfilled")
        .is_("report_video_path", "null").execute()
    )
    if not res.data:
        # Гонка: между гейтом и апдейтом отчёт уже прилетел — свой файл убираем.
        await shelf_svc.remove_promise_videos(db, [path])
        raise HTTPException(status_code=409, detail={"code": "REPORT_EXISTS"})

    await _notify_mentor(
        db, item["_partnership_id"],
        type="promise_report",
        title="🎥 Игрок приложил видеоотчёт",
        message=f"«{item.get('title')}» — отчёт «как это было».",
        payload={"item_id": str(item_id)},
        bot_text=f"🎥 Игрок приложил видеоотчёт к обещанию «{item.get('title')}».",
    )
    return _shelf_out(res.data[0])


@router.post("/me/shelf/{item_id}/hide", response_model=ShelfItemOut)
async def hide_shelf_item(
    item_id: uuid.UUID, current_user: dict = Depends(get_current_user)
) -> ShelfItemOut:
    """«Мне это неинтересно» — лот скрыт у игрока, наставник уведомлён (§8.8).
    Слот остаётся занятым; наставник может сменить цену и перевыставить."""
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    item = await _my_shelf_item(db, me["id"], str(item_id))
    if item["status"] != "active":
        raise HTTPException(status_code=409, detail={"code": "ITEM_NOT_AVAILABLE", "status": item["status"]})

    res = await (
        db.table("shelf_items").update({"status": "hidden"})
        .eq("id", str(item_id)).eq("status", "active").execute()
    )
    if not res.data:
        raise HTTPException(status_code=409, detail={"code": "ITEM_NOT_AVAILABLE"})

    await _notify_mentor(
        db, item["_partnership_id"],
        type="shelf_item_hidden",
        title="🙈 Игроку это неинтересно",
        message=f"«{item.get('title')}» скрыт. Можно сменить цену и перевыставить.",
        payload={"item_id": str(item_id)},
        bot_text=f"🙈 Игрок скрыл лот «{item.get('title')}». Попробуй другую цену или другое обещание.",
    )
    return _shelf_out(res.data[0])


# ---------------------------------------------------------------------------
# Фото-карточка (8.8b): purchase → upload (ai|raw) → choose | reroll
# ---------------------------------------------------------------------------

@router.post("/me/card-photo/purchase", response_model=CardPhotoState)
async def card_photo_purchase(
    body: CardPurchaseReq | None = None,
    current_user: dict = Depends(get_current_user),
) -> CardPhotoState:
    """Покупка смены фото. Режим выбирается ДО оплаты (8c.1): raw — фикс-цена,
    ai — прогрессия по счётчику card_ai_changes. Атомарно через RPC (двойной клик
    не списывает дважды: второй запрос увидит CARD_FLOW_PENDING)."""
    mode = body.mode if body else "ai"
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    cand = me.get("card_photo_candidates") or {}
    if cand.get("status") in ("awaiting_photo", "processing", "choosing"):
        raise HTTPException(status_code=409, detail={"code": "CARD_FLOW_PENDING"})

    prices = await _prices(db)
    if mode == "ai":
        price = _progressive_price(
            prices, "photo_card", int(me.get("card_ai_changes") or 0), PHOTO_CARD_CAP_DEFAULT)
    else:
        price = _price_of(prices, "photo_card")

    res = await db.rpc("begin_card_purchase", {
        "p_user_id": me["id"], "p_price": price, "p_mode": mode,
    }).execute()
    data = res.data if isinstance(res.data, dict) else {}
    if not data.get("ok"):
        code = data.get("code") or "CARD_FLOW_PENDING"
        if code == "INSUFFICIENT_DROPS":
            raise HTTPException(status_code=400, detail={
                "code": code, "balance": int(data.get("balance") or 0), "price": price,
            })
        raise HTTPException(status_code=409, detail={"code": code})

    new_cand = {"status": "awaiting_photo", "mode": mode}
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
    # 8c.1: режим оплачен при покупке — подмена на другой (иначе оплатив raw-фикс,
    # можно было бы получить AI-обработку). Легаси-флоу без mode пропускаем.
    paid_mode = cand.get("mode")
    if paid_mode and paid_mode != body.mode:
        raise HTTPException(status_code=409, detail={"code": "MODE_MISMATCH", "paid_mode": paid_mode})

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

    # mode == 'ai': селфи сохраняем (нужно для reroll и для показа оригинала
    # рядом с вариантами — 8d.1 П.10), генерация фоном.
    selfie_url: str | None = None
    try:
        await db.storage.from_("avatars").upload(
            path=f"{tid}/card_selfie.jpg",
            file=photo_bytes,
            file_options={"content-type": "image/jpeg", "x-upsert": "true"},
        )
        selfie_url = _selfie_public_url(tid, uuid.uuid4().hex[:8])
    except Exception as e:
        logger.warning("card selfie store failed (reroll недоступен): %s", e)

    new_cand = {"status": "processing", "mode": "ai", "selfie_url": selfie_url}
    await (
        db.table("users").update({"card_photo_candidates": new_cand})
        .eq("id", me["id"]).execute()
    )
    asyncio.create_task(
        process_card_photo_variants(photo_bytes, tid, me.get("gender"), selfie_url)
    )
    return _card_state({**me, "card_photo_candidates": new_cand})


@router.post("/me/card-photo/choose", response_model=CardPhotoState)
async def card_photo_choose(
    body: CardChooseReq, current_user: dict = Depends(get_current_user)
) -> CardPhotoState:
    """index >= 0 — выбранный AI-вариант; index == -1 — «оставить как есть»
    (8d.1 Д7): карточкой становится исходное селфи. Смена уже оплачена, доплаты
    нет — игрок просто отказался от обеих обработок."""
    db = await get_supabase()
    me = await _me(db, current_user["telegram_id"])
    cand = me.get("card_photo_candidates") or {}
    variants = list(cand.get("variants") or [])
    if cand.get("status") != "choosing" or not variants:
        raise HTTPException(status_code=409, detail={"code": "NOT_CHOOSING"})

    if body.index == KEEP_ORIGINAL_INDEX:
        update = {
            "card_photo_url": await _keep_original_selfie(db, me["telegram_id"]),
            "card_photo_source": "raw",
            "card_photo_candidates": None,
        }
    else:
        if body.index >= len(variants):
            raise HTTPException(status_code=422, detail={"code": "BAD_INDEX"})
        update = {
            "card_photo_url": variants[body.index],
            "card_photo_source": "ai",
            "card_photo_candidates": None,
        }
    await db.table("users").update(update).eq("id", me["id"]).execute()
    return _card_state({**me, **update})


async def _keep_original_selfie(db, telegram_id: int) -> str:
    """Копия селфи под уникальным именем. Нельзя ссылаться на card_selfie.jpg
    напрямую: путь фиксированный, следующая AI-попытка перезапишет файл и молча
    подменила бы уже установленную карточку."""
    try:
        raw = await db.storage.from_("avatars").download(f"{telegram_id}/card_selfie.jpg")
    except Exception:
        raw = None
    if not raw:
        raise HTTPException(status_code=409, detail={"code": "SELFIE_MISSING"})
    path = f"{telegram_id}/card_raw_{uuid.uuid4().hex[:8]}.jpg"
    try:
        await db.storage.from_("avatars").upload(
            path=path,
            file=raw,
            file_options={"content-type": "image/jpeg", "x-upsert": "true"},
        )
    except Exception as e:
        logger.error("card keep-original upload failed for %s: %s", telegram_id, e)
        raise HTTPException(status_code=500, detail={"code": "STORAGE_FAILED"})
    return f"{_storage_base()}/storage/v1/object/public/avatars/{path}"


@router.post("/me/card-photo/reroll", response_model=CardPhotoState)
async def card_photo_reroll(current_user: dict = Depends(get_current_user)) -> CardPhotoState:
    """Реролл: 2 новых варианта из сохранённого селфи. Цена прогрессирует по
    card_rerolls (8c.1). Атомарно через RPC: двойной клик не списывает дважды —
    второй запрос увидит статус processing → NOT_CHOOSING.

    8d: если есть подаренные reroll_credits, RPC тратит кредит — капли не
    списываются и счётчик прогрессии card_rerolls не двигается (подарок вне
    прогрессии цен). Поэтому нехватка капель при наличии кредита не блокирует."""
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
    price = _progressive_price(
        prices, "photo_reroll", int(me.get("card_rerolls") or 0), PHOTO_REROLL_CAP_DEFAULT)

    res = await db.rpc("begin_card_reroll", {"p_user_id": me["id"], "p_price": price}).execute()
    data = res.data if isinstance(res.data, dict) else {}
    if not data.get("ok"):
        code = data.get("code") or "NOT_CHOOSING"
        if code == "INSUFFICIENT_DROPS":
            raise HTTPException(status_code=400, detail={
                "code": code, "balance": int(data.get("balance") or 0), "price": price,
            })
        raise HTTPException(status_code=409, detail={"code": code})

    # Селфи то же самое — ссылку на оригинал тянем из прошлого раунда (8d.1 П.10).
    selfie_url = cand.get("selfie_url") or _selfie_public_url(tid, uuid.uuid4().hex[:8])
    new_cand = {"status": "processing", "mode": "ai", "selfie_url": selfie_url}
    asyncio.create_task(
        process_card_photo_variants(selfie, tid, me.get("gender"), selfie_url)
    )
    return _card_state({**me, "card_photo_candidates": new_cand})

import api from './client';

/* ============================================================
   Полка наставника (8d)
   R: страница игрока, обещания, Stars-предметы, дарение капель.
   Игрок: покупка / галочка «Выполнено» / «мне неинтересно».
   ============================================================ */

export type ShelfItemType = 'promise' | 'star_item';
export type ShelfItemStatus = 'active' | 'hidden' | 'purchased' | 'fulfilled' | 'archived';

export interface ShelfItem {
    id: string;
    type: ShelfItemType;
    title: string;
    price_drops: number;
    status: ShelfItemStatus;
    star_catalog_key: string | null;
    has_video: boolean;
    has_report: boolean;
    created_at: string | null;
    purchased_at: string | null;
    fulfilled_at: string | null;
}

export interface CatalogItem {
    key: string;
    title: string;
    price_stars: number;
    /** S62-2: РЕКОМЕНДОВАННЫЙ ОРИЕНТИР цены, а не цена выкупа — по нему
        подсвечивается ступень «рекомендуем». Цену назначает наставник. */
    price_drops: number;
}

/** Лот со свободным текстом наставника (звание) — при покупке нужен ввод. */
export const TITLE_LOT_KEY = 'title';
export const MAX_TITLE_LEN = 24;

export interface PriceLimits {
    min: number;
    max: number;
}

/** Ступень цены лота: наставник выбирает смысл, цифру считает бэк (S62-2). */
export interface LotPricePreset {
    key: string;
    label: string;
    percent: number;
    price: number;
}

export interface LotPricing {
    /** Теоретический месячный потолок капель игрока — подсказка наставнику.
        ⚠️ Инвариант §1: это потолок ФОРМУЛ, не заработок и не баланс игрока. */
    cap: number;
    min: number;
    max: number;
    presets: LotPricePreset[];
    /** key каталога → key рекомендованной ступени. */
    recommended: Record<string, string>;
}

/** 8d.1 (П.3a): атрибут досье — чип «🎯 Цель: похудеть» у фото игрока. */
export interface ProfileChip {
    icon: string;
    label: string;
    value: string;
    /** 8d.1a: 'warn' — тревожная подсветка (подписка на исходе). Порог решает бэк. */
    tone?: string | null;
}

export interface PlayerPage {
    player_id: string;
    partnership_id: string;
    first_name: string | null;
    card_photo_url: string;
    profile_line: string;
    profile_chips: ProfileChip[];
    gender: string | null;
    xp: number;
    current_streak: number;
    best_streak: number;
    last_workout_date: string | null;
    /* 8d.1a: дни считает бэк в поясе ИГРОКА, фронт только подписывает. */
    last_workout_days_ago: number | null;
    main_days: number[] | null;
    subscription_days_left: number | null;
    slots_used: number;
    slots_total: number;
    shelf: ShelfItem[];
    pending: ShelfItem[];
    reports: ShelfItem[];       // исполненные обещания с видеоотчётом игрока
    /** S62-3.3: единая репутация — главная цифра СУММА КАПЕЛЬ (исполненные
        обещания + выкупленные лоты), счёт позиций ушёл в расшифровку. */
    reputation_count: number;
    reputation_drops: number;
    pending_count: number;
    gift_balance: number;
    price_limits: PriceLimits;  // админ-лимиты цены ВИДЕО-ОБЕЩАНИЯ (не лота)
    catalog: CatalogItem[];
    /** S62-2: ступени и коридор цены лота для этого игрока. */
    lot_pricing: LotPricing;
    /** Звание игрока (лот `title`), если выкуплено. */
    player_title: string | null;
    /** Дарение заморозки: цена = витринной, cap_reached — запас игрока полон. */
    freeze_gift_price: number;
    freeze_gift_cap_reached: boolean;
}

export interface ShelfCatalogState {
    catalog: CatalogItem[];
    price_limits: PriceLimits;
    gift_balance: number;
    /** Э.3.2: индикатор подписки в шапке Market R. Порог красноты решает бэк. */
    tier: string | null;
    subscription_days_left: number | null;
    subscription_warn: boolean;
}

/* ---------- Responsible ---------- */

export async function getPlayerPage(playerId: string): Promise<PlayerPage> {
    const { data } = await api.get(`/shelf/players/${playerId}/page`);
    return data;
}

export async function getShelfCatalog(): Promise<ShelfCatalogState> {
    const { data } = await api.get('/shelf/catalog');
    return data;
}

/** Расширение файла по реальному MIME блоба (Safari отдаёт mp4, Chrome — webm). */
export function videoExt(blob: Blob): string {
    const t = (blob.type || '').toLowerCase();
    if (t.includes('mp4')) return 'mp4';
    if (t.includes('quicktime') || t.includes('mov')) return 'mov';
    return 'webm';
}

export async function createPromise(params: {
    playerId: string;
    title: string;
    priceDrops: number;
    video: Blob;
    onProgress?: (pct: number) => void;
}): Promise<ShelfItem> {
    const form = new FormData();
    form.append('player_id', params.playerId);
    form.append('title', params.title);
    form.append('price_drops', String(params.priceDrops));
    form.append('video', params.video, `promise.${videoExt(params.video)}`);
    const { data } = await api.post('/shelf/promise', form, {
        timeout: 120_000,
        onUploadProgress: (e) => {
            if (params.onProgress && e.total) {
                params.onProgress(Math.round((e.loaded / e.total) * 100));
            }
        },
    });
    return data;
}

export async function createStarItemInvoice(
    playerId: string, catalogKey: string, priceDrops: number, titleText?: string,
): Promise<{ payment_id: string; invoice_link: string }> {
    const { data } = await api.post('/shelf/star-item', {
        player_id: playerId, catalog_key: catalogKey, price_drops: priceDrops,
        ...(titleText ? { title_text: titleText } : {}),
    });
    return data;
}

export async function patchShelfItem(
    itemId: string, patch: { price_drops?: number; status?: 'active' | 'hidden' },
): Promise<ShelfItem> {
    const { data } = await api.patch(`/shelf/items/${itemId}`, patch);
    return data;
}

export async function deleteShelfItem(itemId: string): Promise<void> {
    await api.delete(`/shelf/items/${itemId}`);
}

export async function giftDrops(playerId: string, amount: number): Promise<{
    gifted: number; gift_balance: number;
}> {
    const { data } = await api.post('/shelf/gift-drops', { player_id: playerId, amount });
    return data;
}

/** Хвост 4: заморозка дарится за капли из пула (цена = витринной), +1 в запас
    игрока при капе 3. Легаси-кошелёк `gift_freeze_balance` упразднён в 039. */
export async function giftFreeze(playerId: string): Promise<{
    price: number; gift_balance: number;
}> {
    const { data } = await api.post('/shelf/gift-freeze', { player_id: playerId });
    return data;
}

/* ---------- Общее: подписанная ссылка на приватное видео ---------- */

export async function getItemVideoUrl(
    itemId: string, kind: 'promise' | 'report' = 'promise',
): Promise<string> {
    const { data } = await api.get(`/shelf/items/${itemId}/video-url`, { params: { kind } });
    return data.url;
}

/* ---------- Player ---------- */

export interface ShelfBuyResult {
    drops_balance: number;
    status: ShelfItemStatus;
    paid_freezes: number | null;
    reroll_credits: number | null;
}

export async function buyShelfItem(itemId: string): Promise<ShelfBuyResult> {
    const { data } = await api.post(`/players/me/shelf/${itemId}/buy`);
    return data;
}

export async function fulfillShelfItem(
    itemId: string, video?: Blob | null, onProgress?: (pct: number) => void,
): Promise<ShelfItem> {
    const url = `/players/me/shelf/${itemId}/fulfill`;
    /* ПУСТУЮ FormData слать нельзя: браузер отправляет тело из одной закрывающей
       границы («--X--»), и парсер Starlette валится с 400 «error parsing the
       body» — галочка без видеоотчёта не проходила вообще (смоук 8d.1, п.11).
       Без тела запрос доходит до обработчика и video приезжает как None. */
    if (!video) {
        const { data } = await api.post(url, undefined, { timeout: 120_000 });
        return data;
    }
    const form = new FormData();
    form.append('video', video, `report.${videoExt(video)}`);
    const { data } = await api.post(url, form, {
        timeout: 120_000,
        onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
    });
    return data;
}

/** 8d.1 (Д6): видеоотчёт ПОСЛЕ галочки — отдельным шагом, репутацию не растит. */
export async function attachShelfReport(
    itemId: string, video: Blob, onProgress?: (pct: number) => void,
): Promise<ShelfItem> {
    const form = new FormData();
    form.append('video', video, `report.${videoExt(video)}`);
    const { data } = await api.post(`/players/me/shelf/${itemId}/report`, form, {
        timeout: 120_000,
        onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
    });
    return data;
}

export async function hideShelfItem(itemId: string): Promise<ShelfItem> {
    const { data } = await api.post(`/players/me/shelf/${itemId}/hide`);
    return data;
}

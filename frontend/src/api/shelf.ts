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
}

export interface PriceLimits {
    min: number;
    max: number;
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
    reputation_count: number;   // исполнено обещаний (Д3 — главная цифра)
    reputation_drops: number;   // на сколько капель — расшифровка
    pending_count: number;
    gift_balance: number;
    gift_freeze_balance: number;
    price_limits: PriceLimits;
    catalog: CatalogItem[];
}

export interface ShelfCatalogState {
    catalog: CatalogItem[];
    price_limits: PriceLimits;
    gift_balance: number;
    gift_freeze_balance: number;
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
    playerId: string, catalogKey: string, priceDrops: number,
): Promise<{ payment_id: string; invoice_link: string }> {
    const { data } = await api.post('/shelf/star-item', {
        player_id: playerId, catalog_key: catalogKey, price_drops: priceDrops,
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

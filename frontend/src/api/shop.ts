import api from './client';
import type { ShelfItem } from './shelf';

/* ============================================================
   Остаток легаси-магазина после 8d: только дарение ЗАМОРОЗОК
   из пула наставника (gift_freeze_balance). Лоты shop_items и
   покупки выпилены — их заменила полка (api/shelf.ts).
   ============================================================ */

export interface GiftFreezeRequest {
    player_id: string;
    freeze_count: number;
    message?: string;
}

export interface GiftFreezeResponse {
    gifted: number;
    new_gift_freeze_balance: number;
    new_player_streak_freeze_balance: number;
}

export async function giftFreeze(req: GiftFreezeRequest): Promise<GiftFreezeResponse> {
    const { data } = await api.post('/shop/gift-freeze', req);
    return data;
}

/* ============================================================
   8c: витрина игрока (app_shop_items) — /players/me/shop
   ============================================================ */

/** 8d.1 (П.10): чем обработан вариант — слабая или глубокая обработка. */
export type CardVariantMode = 'weak' | 'deep';

export interface CardPhotoState {
    url: string | null;
    source: 'ai' | 'raw' | null;
    status: 'awaiting_photo' | 'processing' | 'choosing' | 'failed' | null;
    mode: 'ai' | 'raw' | null;   // 8c.1: режим текущего флоу, оплачен при покупке
    variants: string[];
    // 8d.1: variant_modes[i] описывает variants[i]; selfie_url — оригинал рядом.
    variant_modes: CardVariantMode[];
    selfie_url: string | null;
}

export interface RestoreOffer {
    lost_streak_len: number;
    lost_streak_at: string;
    price: number;
    expires_at: string;
}

export interface PlayerShopState {
    drops_balance: number;
    prices: Record<string, number>;   // key → price_drops
    free_freezes_left: number;
    paid_freezes: number;
    paid_freezes_cap: number;
    restore: RestoreOffer | null;
    card_photo: CardPhotoState;
    // 8c.1: актуальные для юзера цены (прогрессия AI-смен/рероллов)
    photo_card_ai_price: number | null;
    photo_card_raw_price: number | null;
    photo_reroll_price: number | null;
    // 8d: подаренные рероллы (вне прогрессии цен) + полка наставника
    reroll_credits: number;
    shelf: ShelfItem[];
    my_purchases: ShelfItem[];
    // 8d.1 (П.7): полка видна всегда при живом партнёрстве — пустые слоты
    // рисуются заглушками, их количество = слотам тарифа наставника.
    has_mentor: boolean;
    shelf_slots_total: number;
}

export async function getPlayerShop(): Promise<PlayerShopState> {
    const { data } = await api.get('/players/me/shop');
    return data;
}

export async function buyFreeze(): Promise<{ drops_balance: number; paid_freezes: number }> {
    const { data } = await api.post('/players/me/buy-freeze');
    return data;
}

export async function restoreStreak(): Promise<{ drops_balance: number; current_streak: number }> {
    const { data } = await api.post('/players/me/restore-streak');
    return data;
}

export async function cardPhotoPurchase(mode: 'ai' | 'raw'): Promise<CardPhotoState> {
    const { data } = await api.post('/players/me/card-photo/purchase', { mode });
    return data;
}

export async function cardPhotoUpload(photoBase64: string, mode: 'ai' | 'raw'): Promise<CardPhotoState> {
    const { data } = await api.post('/players/me/card-photo/upload', {
        photo_base64: photoBase64,
        mode,
    }, { timeout: 60_000 });
    return data;
}

/** 8d.1 (Д7): «оставить как есть» — карточкой станет исходное селфи без AI. */
export const KEEP_ORIGINAL_INDEX = -1;

export async function cardPhotoChoose(index: number): Promise<CardPhotoState> {
    const { data } = await api.post('/players/me/card-photo/choose', { index });
    return data;
}

export async function cardPhotoReroll(): Promise<CardPhotoState> {
    const { data } = await api.post('/players/me/card-photo/reroll');
    return data;
}

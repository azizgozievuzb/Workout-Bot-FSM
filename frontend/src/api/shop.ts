import api from './client';

export interface ShopItem {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    price_drops: number;
    emoji: string | null;
    is_active: boolean;
    item_type: string;
    freeze_count: number;
    responsible_id: string | null;
    player_id: string | null;
}

export interface PurchaseResponse {
    success: boolean;
    new_balance: number;
    message: string;
}

export interface CreateShopItemRequest {
    item_type: 'streak_freeze';
    freeze_count: number;
    price_drops: number;
    name: string;
    emoji?: string;
    player_id: string;
}

export interface CreateShopItemResponse {
    item: ShopItem;
    new_shop_freeze_balance: number;
}

export interface DeleteShopItemResponse {
    deleted: boolean;
    refunded: number;
    new_shop_freeze_balance: number;
}

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

export async function getShopItems(playerId?: string): Promise<ShopItem[]> {
    const params = playerId ? { player_id: playerId } : undefined;
    const { data } = await api.get('/shop/items', { params });
    return data;
}

export async function purchaseItem(itemId: string): Promise<PurchaseResponse> {
    const { data } = await api.post('/shop/purchase', { item_id: itemId });
    return data;
}

export async function createShopItem(req: CreateShopItemRequest): Promise<CreateShopItemResponse> {
    const { data } = await api.post('/shop/items', req);
    return data;
}

export async function deleteShopItem(itemId: string): Promise<DeleteShopItemResponse> {
    const { data } = await api.delete(`/shop/items/${itemId}`);
    return data;
}

export async function giftFreeze(req: GiftFreezeRequest): Promise<GiftFreezeResponse> {
    const { data } = await api.post('/shop/gift-freeze', req);
    return data;
}

/* ============================================================
   8c: витрина игрока (app_shop_items) — /players/me/shop
   ============================================================ */

export interface CardPhotoState {
    url: string | null;
    source: 'ai' | 'raw' | null;
    status: 'awaiting_photo' | 'processing' | 'choosing' | 'failed' | null;
    variants: string[];
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

export async function cardPhotoPurchase(): Promise<CardPhotoState> {
    const { data } = await api.post('/players/me/card-photo/purchase');
    return data;
}

export async function cardPhotoUpload(photoBase64: string, mode: 'ai' | 'raw'): Promise<CardPhotoState> {
    const { data } = await api.post('/players/me/card-photo/upload', {
        photo_base64: photoBase64,
        mode,
    }, { timeout: 60_000 });
    return data;
}

export async function cardPhotoChoose(index: number): Promise<CardPhotoState> {
    const { data } = await api.post('/players/me/card-photo/choose', { index });
    return data;
}

export async function cardPhotoReroll(): Promise<CardPhotoState> {
    const { data } = await api.post('/players/me/card-photo/reroll');
    return data;
}

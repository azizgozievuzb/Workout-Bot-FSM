import api from './client';

export interface ShopItem {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    price_stars: number;
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
    price_stars: number;
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

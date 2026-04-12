import api from './client';

export interface ShopItem {
    id: string;
    name: string;
    description: string;
    category: string;
    price_stars: number;
    emoji: string;
    is_active: boolean;
}

export interface PurchaseResponse {
    success: boolean;
    new_balance: number;
    message: string;
}

export async function getShopItems(): Promise<ShopItem[]> {
    const { data } = await api.get('/shop/items');
    return data;
}

export async function purchaseItem(itemId: string): Promise<PurchaseResponse> {
    const { data } = await api.post('/shop/purchase', { item_id: itemId });
    return data;
}

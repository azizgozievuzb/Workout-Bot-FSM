import api from './client';

export interface AdminPaymentRow {
    id: string;
    buyer_name: string | null;
    buyer_telegram_id: number | null;
    product_type: string;
    product_title: string | null;
    amount_stars: number;
    status: string;
    created_at: string | null;
    tier: string | null;
    period: string | null;
    discount_pct: number | null;
    coupon_code: string | null;
}

export interface RefundResponse {
    refunded: boolean;
}

export interface AdminStarProduct {
    product_type: string;
    title: string;
    description: string;
    price_stars: number;
    is_active: boolean;
    updated_at: string | null;
}

export interface StarsBalance {
    amount: number;
    nanostar_amount: number;
}

export async function listPayments(status?: string, limit = 50, offset = 0): Promise<AdminPaymentRow[]> {
    const params: Record<string, string | number> = { limit, offset };
    if (status) params.status = status;
    const { data } = await api.get('/admin/payments', { params });
    return data;
}

export async function refundPayment(id: string): Promise<RefundResponse> {
    const { data } = await api.post(`/admin/payments/${id}/refund`);
    return data;
}

export async function listStarProducts(): Promise<AdminStarProduct[]> {
    const { data } = await api.get('/admin/star-products');
    return data;
}

export async function updateStarProduct(
    productType: string,
    patch: { price_stars?: number; is_active?: boolean },
): Promise<AdminStarProduct> {
    const { data } = await api.patch(`/admin/star-products/${productType}`, patch);
    return data;
}

export async function getStarsBalance(): Promise<StarsBalance> {
    const { data } = await api.get('/admin/stars-balance');
    return data;
}

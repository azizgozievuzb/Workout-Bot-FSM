import api from './client';
import type { AccessTier } from '../stores/authStore';

export type SubscriptionPeriod = 'intro' | '1m' | '3m' | '12m';

export interface DropPack {
    key: string;
    drops: number;
    price_stars: number;
}

export interface TierPrice {
    tier: AccessTier;
    intro_price_stars: number;
    price_1m: number;
    price_3m: number;
    price_12m: number;
}

export interface InvoiceResponse {
    payment_id: string;
    invoice_link: string;
}

export type PaymentStatus = 'pending' | 'paid' | 'fulfilled' | 'failed' | 'refunded';

export interface PaymentStatusResponse {
    status: PaymentStatus;
}

export async function getDropPacks(): Promise<DropPack[]> {
    const { data } = await api.get('/payments/drop-packs');
    return data;
}

export async function createDropPackInvoice(packKey: string): Promise<InvoiceResponse> {
    const { data } = await api.post('/payments/drop-pack-invoice', { pack_key: packKey });
    return data;
}

export async function getPayment(id: string): Promise<PaymentStatusResponse> {
    const { data } = await api.get(`/payments/${id}`);
    return data;
}

export async function getTierPrices(): Promise<TierPrice[]> {
    const { data } = await api.get('/payments/tier-prices');
    return data;
}

export async function createTierInvoice(
    tier: AccessTier,
    period: SubscriptionPeriod,
    couponCode?: string,
): Promise<InvoiceResponse> {
    const { data } = await api.post('/payments/tier-invoice', {
        tier, period, coupon_code: couponCode || null,
    });
    return data;
}

export interface CouponPreview {
    valid: boolean;
    pct: number;
    final_price: number;
    base_price: number;
    code: string | null;
}

export async function previewCoupon(
    code: string,
    tier: AccessTier,
    period: '1m' | '3m' | '12m',
): Promise<CouponPreview> {
    const { data } = await api.post('/payments/coupon-preview', { code, tier, period });
    return data;
}

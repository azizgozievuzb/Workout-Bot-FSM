import api from './client';
import type { AccessTier } from '../stores/authStore';

export interface Coupon {
  id: string;
  code: string;
  discount_pct: number;
  is_active: boolean;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  created_at: string | null;
}

export interface AdminTierPrice {
  tier: AccessTier;
  intro_price_stars: number;
  price_1m: number;
  price_3m: number;
  price_12m: number;
  updated_at: string | null;
}

export type PricingMode = 'free' | 'custom' | null;

// --- Coupons ---
export async function listCoupons(): Promise<Coupon[]> {
  const { data } = await api.get('/admin/coupons');
  return data;
}

export async function createCoupon(body: {
  code?: string;
  discount_pct: number;
  max_uses?: number | null;
  expires_at?: string | null;
}): Promise<Coupon> {
  const { data } = await api.post('/admin/coupons', body);
  return data;
}

export async function updateCoupon(id: string, isActive: boolean): Promise<Coupon> {
  const { data } = await api.patch(`/admin/coupons/${id}`, { is_active: isActive });
  return data;
}

// --- Tier prices ---
export async function listAdminTierPrices(): Promise<AdminTierPrice[]> {
  const { data } = await api.get('/admin/tier-prices');
  return data;
}

export async function updateTierPrice(
  tier: AccessTier,
  patch: Partial<Pick<AdminTierPrice, 'intro_price_stars' | 'price_1m' | 'price_3m' | 'price_12m'>>,
): Promise<AdminTierPrice> {
  const { data } = await api.patch(`/admin/tier-prices/${tier}`, patch);
  return data;
}

// --- User pricing override ---
export async function setUserPricing(
  userId: string,
  mode: PricingMode,
  customPriceStars?: number,
): Promise<{ id: string; pricing_mode: PricingMode; custom_price_stars: number | null }> {
  const { data } = await api.patch(`/admin/users/${userId}/pricing`, {
    mode,
    custom_price_stars: mode === 'custom' ? customPriceStars : null,
  });
  return data;
}

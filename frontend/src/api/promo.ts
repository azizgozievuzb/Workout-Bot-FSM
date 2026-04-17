import api from './client';

export type AccessTier = 'standard' | 'premium' | 'elite';
export type DurationDays = 7 | 30 | 90 | 180;

export interface MyPlayerCodeResponse {
    code: string | null;
    deep_link: string | null;
    is_used: boolean;
    used_by_name: string | null;
    duration_days: number | null;
    expires_at: string | null;
    days_left: number | null;
    access_tier: AccessTier;
    is_renewal: boolean;
}

export interface PlayerStatusResponse {
    is_active: boolean;
    expires_at: string | null;
    days_left: number | null;
    duration_days: number | null;
}

export async function activatePromo(code: string) {
    const res = await api.post('/promo/activate', { code });
    return res.data;
}

export async function activatePromoLink(token: string) {
    const res = await api.post(`/promo/activate-link/${token}`);
    return res.data;
}

export async function getMyPlayerCode(): Promise<MyPlayerCodeResponse> {
    const res = await api.get('/promo/my-player-code');
    return res.data;
}

export async function getPlayerStatus(): Promise<PlayerStatusResponse> {
    const res = await api.get('/promo/player-status');
    return res.data;
}

export interface NewPlayerCodeResponse {
    code: string;
    deep_link: string;
    duration_days: number;
}

export async function createNewPlayerCode(duration_days: 7 | 30 | 90): Promise<NewPlayerCodeResponse> {
    const res = await api.post('/promo/new-player-code', { duration_days });
    return res.data;
}

export interface CreateResponsibleCodeResponse {
    code: string;
    expires_at: string | null;
}

export async function createResponsibleCode(
    tier: AccessTier,
    duration: DurationDays,
): Promise<CreateResponsibleCodeResponse> {
    const res = await api.post('/admin/promo/responsible', { access_tier: tier, duration_days: duration });
    return res.data;
}

export interface CreateRenewalCodeResponse {
    code: string;
}

export async function createRenewalCode(
    tier: AccessTier,
    duration: DurationDays,
): Promise<CreateRenewalCodeResponse> {
    const res = await api.post('/admin/promo/renewal', { access_tier: tier, duration_days: duration });
    return res.data;
}

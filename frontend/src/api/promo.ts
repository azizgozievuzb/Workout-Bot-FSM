import api from './client';

export interface MyPlayerCodeResponse {
    code: string | null;
    deep_link: string | null;
    is_used: boolean;
    used_by_name: string | null;
    duration_days: number | null;
    expires_at: string | null;
    days_left: number | null;
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

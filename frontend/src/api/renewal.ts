import api from './client';

export interface RenewalRequest {
    id: string;
    player_id: string;
    player_name: string | null;
    player_photo_url: string | null;
    created_at: string;
}

export interface MyPlayer {
    id: string;
    partnership_id: string;
    telegram_id: number;
    first_name: string | null;
    profile_photo_url: string | null;
    access_tier: 'standard' | 'premium' | 'elite';
    days_left: number | null;
    is_deactivated: boolean;
}

export async function createRenewalRequest(): Promise<{ status: 'sent' }> {
    const res = await api.post('/renewal/request');
    return res.data;
}

export async function listMyRenewalRequests(): Promise<RenewalRequest[]> {
    const res = await api.get('/renewal/my-requests');
    return res.data;
}

export async function listMyPlayers(): Promise<MyPlayer[]> {
    const res = await api.get('/partnerships/my-players');
    return res.data;
}

export async function renewPlayer(
    partnership_id: string,
    code: string,
): Promise<{ renewed: boolean; added_days: number; new_expires_at: string }> {
    const res = await api.post('/promo/apply-renewal-player', { code, partnership_id });
    return res.data;
}

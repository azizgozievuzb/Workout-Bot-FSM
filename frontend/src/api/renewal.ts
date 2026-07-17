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


export async function listMyPlayers(): Promise<MyPlayer[]> {
    const res = await api.get('/partnerships/my-players');
    return res.data;
}

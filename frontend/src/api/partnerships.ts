import api from './client';
import type { AccessTier } from './promo';

export interface MyPlayer {
    partnership_id: string;
    id: string;
    telegram_id: number;
    first_name: string | null;
    profile_photo_url: string | null;
    access_tier: AccessTier;
    expires_at: string | null;
    is_expired: boolean;
    days_left: number | null;
    days_since_expired: number | null;
    is_deactivated: boolean;
}

export interface DeletePartnershipResponse {
    deleted: boolean;
    player_hard_deleted: boolean;
}

export async function getMyPlayers(): Promise<MyPlayer[]> {
    const res = await api.get('/partnerships/my-players');
    return res.data;
}

export async function deletePartnership(partnershipId: string): Promise<DeletePartnershipResponse> {
    const res = await api.delete(`/partnerships/${partnershipId}`);
    return res.data;
}

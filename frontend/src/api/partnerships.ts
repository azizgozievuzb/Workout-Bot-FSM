import api from './client';

export interface MyPlayer {
    partnership_id: string;
    id: string;
    telegram_id: number;
    first_name: string | null;
    // 8c (8.8b): наставник видит только фото-карточку (или мультяшку по полу)
    card_photo_url: string;
    expires_at: string | null;
    is_expired: boolean;
    days_left: number | null;
    days_since_expired: number | null;
    is_deactivated: boolean;
    // 8d: бейдж «⏳ N» — выкупленные, но не исполненные обещания
    pending_promises: number;
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

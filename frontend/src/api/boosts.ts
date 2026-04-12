import api from './client';

export interface ActiveBoost {
    active: boolean;
    boost_type: string | null;
    expires_at: string | null;
    hours_left: number | null;
}

export interface BuyBoostResponse {
    success: boolean;
    expires_at: string;
    message: string;
}

export async function getActiveBoost(): Promise<ActiveBoost> {
    const { data } = await api.get('/boosts/active');
    return data;
}

export async function buyBoost(playerId: string, boostType: string = '1_day'): Promise<BuyBoostResponse> {
    const { data } = await api.post('/boosts/buy', { player_id: playerId, boost_type: boostType });
    return data;
}

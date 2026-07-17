import api from './client';

export interface ActiveBoost {
    active: boolean;
    boost_type: string | null;
    expires_at: string | null;
    hours_left: number | null;
}

export async function getActiveBoost(): Promise<ActiveBoost> {
    const { data } = await api.get('/boosts/active');
    return data;
}

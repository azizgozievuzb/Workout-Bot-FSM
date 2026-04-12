import api from './client';

export interface PlayerStats {
    global_score: number;
    three_day_score: number;
    current_streak: number;
    best_streak: number;
    last_workout_date: string | null;
    star_balance: number;
    level_window: number[];
    rest_days_remaining: number;
    rest_days_used_this_month: number;
}

export interface PartnerStats {
    player_id: string;
    first_name: string;
    current_streak: number;
    best_streak: number;
    star_balance: number;
    last_workout_date: string | null;
    global_score: number;
}

export async function getMyStats(): Promise<PlayerStats> {
    const { data } = await api.get('/stats/me');
    return data;
}

export async function getPartnerStats(): Promise<PartnerStats[]> {
    const { data } = await api.get('/stats/partner');
    return data;
}

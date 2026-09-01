import api from './client';

export interface PlayerStats {
    global_score: number;
    three_day_score: number;
    current_streak: number;
    best_streak: number;
    last_workout_date: string | null;
    drops_balance: number;
    level_window: number[];
    rest_days_remaining: number;
    rest_days_used_this_month: number;
    free_freezes_left?: number;
    paid_freezes?: number;
    last_closed_day?: string | null;
    /** Эконом-патч №1: имя + звание для шапки главного экрана игрока. */
    first_name?: string | null;
    player_title?: string | null;
    /** S67: XP и уровень. Лестницу считает БЭК — фронт только рисует. */
    xp?: number;
    level?: number;
    xp_in_level?: number;
    level_cost?: number;
}

export interface PartnerStats {
    player_id: string;
    first_name: string;
    current_streak: number;
    best_streak: number;
    drops_balance: number;
    last_workout_date: string | null;
    global_score: number;
    is_deactivated: boolean;
    deactivated_at: string | null;
}

export async function getMyStats(): Promise<PlayerStats> {
    const { data } = await api.get('/stats/me');
    return data;
}

export async function getPartnerStats(): Promise<PartnerStats[]> {
    const { data } = await api.get('/stats/partner');
    return data;
}

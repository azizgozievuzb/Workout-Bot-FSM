import api from './client';

export interface PromoCodeInfo {
    id: string;
    code: string;
    code_type: string;
    tier: string;
    is_used: boolean;
    used_by: string | null;
    responsible_id: string | null;
    created_at: string | null;
}

export async function createPromoCodes(tier: string = 'basic', count: number = 1) {
    const res = await api.post('/admin/promo/create', { tier, count });
    return res.data as { codes: string[] };
}

export async function listPromoCodes(params?: { code_type?: string; is_used?: boolean; tier?: string }) {
    const res = await api.get('/admin/promo/list', { params });
    return res.data as { codes: PromoCodeInfo[] };
}

export interface PlayerInPair {
    telegram_id: number;
    display_name: string | null;
    username: string | null;
    is_deactivated: boolean;
}

export interface ResponsibleGroup {
    telegram_id: number;
    display_name: string | null;
    username: string | null;
    players: PlayerInPair[];
}

export interface ConnectionsResponse {
    groups: ResponsibleGroup[];
}

export async function getConnections(): Promise<ConnectionsResponse> {
    const res = await api.get('/admin/connections');
    return res.data;
}

export interface ToggleMaintenanceResponse {
    maintenance_mode: boolean;
    frozen_seconds: number | null;
}

export async function toggleMaintenance(): Promise<ToggleMaintenanceResponse> {
    const res = await api.post('/admin/maintenance/toggle');
    return res.data;
}

export interface BanUserRequest {
    days: number;
    reason: string;
    missed_workouts: number;
}

export async function banUser(userId: string, req: BanUserRequest): Promise<{ banned: boolean; ban_until: string }> {
    const res = await api.post(`/admin/users/${userId}/ban`, req);
    return res.data;
}

export async function unbanUser(userId: string): Promise<{ banned: boolean }> {
    const res = await api.post(`/admin/users/${userId}/unban`);
    return res.data;
}

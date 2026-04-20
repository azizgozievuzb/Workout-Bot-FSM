import api from './client';
import type { AccessTier, DurationDays } from './promo';

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

export async function listPromoCodes(params?: { code_type?: string; is_used?: boolean; tier?: string }) {
    const res = await api.get('/admin/promo/list', { params });
    return res.data as { codes: PromoCodeInfo[] };
}

export interface PlayerStats {
    workouts_done: number;
    stars_balance: number;
    last_workout_at: string | null;
    completion_rate: number;
}

export interface ResponsibleStats {
    total_workouts: number;
    active_players: number;
    total_stars_earned: number;
    avg_completion_rate: number;
}

export interface PlayerInPair {
    id: string;
    telegram_id: number;
    display_name: string | null;
    username: string | null;
    is_deactivated: boolean;
    is_banned: boolean;
    ban_until: string | null;
    stats: PlayerStats | null;
}

export interface ResponsibleGroup {
    telegram_id: number;
    display_name: string | null;
    username: string | null;
    players: PlayerInPair[];
    stats: ResponsibleStats | null;
}

export interface BanHistoryEntry {
    id: string;
    user_id: string;
    display_name: string | null;
    telegram_id: number;
    banned_at: string;
    ban_until: string;
    reason: string;
    missed_workouts: number;
    is_active: boolean;
    unbanned_early: boolean;
}

export type BatchCodeType = 'responsible' | 'player' | 'renewal';

export interface BatchBuyRequest {
    code_type: BatchCodeType;
    tier: AccessTier;
    duration: DurationDays;
    count: number;
}

export interface BatchBuyResponse {
    codes: string[];
    total_stars_cost: number;
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

export interface MaintenanceStatus {
    maintenance_mode: boolean;
    started_at: string | null;
    frozen_seconds: number | null;
}

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
    const res = await api.get('/admin/maintenance/status');
    return res.data;
}

export async function batchBuyCodes(req: BatchBuyRequest): Promise<BatchBuyResponse> {
    const res = await api.post('/admin/codes/batch-buy', req);
    return res.data;
}

export async function getBanHistory(): Promise<{ bans: BanHistoryEntry[] }> {
    const res = await api.get('/admin/bans/history');
    return res.data;
}

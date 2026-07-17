import api from './client';
import type { AccessTier } from '../stores/authStore';

type DurationDays = 7 | 30 | 90 | 180;

export interface PlayerStats {
    workouts_done: number;
    drops_balance: number;
    last_workout_at: string | null;
    completion_rate: number;
}

export interface ResponsibleStats {
    total_workouts: number;
    active_players: number;
    total_xp_earned: number;
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

// Tier downgrade with player eviction (7.5) — no promo codes.
export interface TierDowngradeRequest {
    target_tier: AccessTier;
    player_ids_to_evict: string[];
}

export interface TierDowngradeResponse {
    evicted_count: number;
    new_tier: string;
    remaining_players: { id: string; first_name: string | null }[];
}

export async function applyTierDowngrade(
    req: TierDowngradeRequest,
): Promise<TierDowngradeResponse> {
    const res = await api.post('/admin/apply-tier-downgrade', req);
    return res.data;
}


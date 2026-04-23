import api from './client';

export interface AppNotification {
    id: string;
    type: string;
    title: string;
    message: string;
    payload: Record<string, unknown>;
    read_at: string | null;
    created_at: string;
}

export interface NotificationListResponse {
    items: AppNotification[];
    unread_count: number;
}

export async function getNotifications(limit = 50, offset = 0): Promise<NotificationListResponse> {
    const { data } = await api.get('/notifications', { params: { limit, offset } });
    return data;
}

export async function getUnreadCount(): Promise<number> {
    const { data } = await api.get('/notifications/unread-count');
    return (data as { count: number }).count;
}

export async function markRead(notificationId: string): Promise<void> {
    await api.post(`/notifications/${notificationId}/read`);
}

export async function markAllRead(): Promise<{ updated: number }> {
    const { data } = await api.post('/notifications/read-all');
    return data;
}

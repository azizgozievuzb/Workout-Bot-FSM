import React, { useState, useEffect, useCallback } from 'react';
import { getNotifications, markRead, markAllRead } from '../../api/notifications';
import type { AppNotification } from '../../api/notifications';
import { useAuthStore } from '../../stores/authStore';
import { NotificationRenderer } from './NotificationRenderer';

function formatTs(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);
    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (date >= todayStart) {
        const h = date.getHours().toString().padStart(2, '0');
        const m = date.getMinutes().toString().padStart(2, '0');
        return `сегодня в ${h}:${m}`;
    }
    const d = date.getDate().toString().padStart(2, '0');
    const mo = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${d}.${mo}`;
}

export const NotificationList: React.FC = () => {
    const { setUnreadNotifications } = useAuthStore();
    const [items, setItems] = useState<AppNotification[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getNotifications(50)
            .then((res) => {
                setItems(res.items);
                setUnreadNotifications(res.unread_count);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [setUnreadNotifications]);

    const handleMarkRead = useCallback((id: string) => {
        setItems((prev) => prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
        const current = useAuthStore.getState().unreadNotifications;
        setUnreadNotifications(Math.max(0, current - 1));
        markRead(id).catch(() => {});
    }, [setUnreadNotifications]);

    const handleMarkAll = useCallback(() => {
        const now = new Date().toISOString();
        setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
        setUnreadNotifications(0);
        markAllRead().catch(() => {});
    }, [setUnreadNotifications]);

    const unreadCount = items.filter((n) => !n.read_at).length;

    if (loading) {
        return (
            <div className="notif-list">
                <div className="notif-skeleton-row notif-skeleton" />
                <div className="notif-skeleton-row notif-skeleton" />
                <div className="notif-skeleton-row notif-skeleton" />
            </div>
        );
    }

    if (items.length === 0) {
        return <div className="notif-empty">Нет уведомлений</div>;
    }

    return (
        <div className="notif-list">
            {unreadCount > 0 && (
                <button className="notif-mark-all-btn" onClick={handleMarkAll}>
                    Отметить все прочитанными
                </button>
            )}
            {items.map((n) => {
                const isUnread = !n.read_at;
                return (
                    <div
                        key={n.id}
                        className={`notif-row${isUnread ? ' notif-row--unread' : ''}`}
                        onClick={isUnread ? () => handleMarkRead(n.id) : undefined}
                    >
                        <span className={`notif-dot${isUnread ? ' notif-dot--unread' : ' notif-dot--read'}`} />
                        <div className="notif-row-content">
                            <NotificationRenderer type={n.type} payload={n.payload} />
                            <div className="notif-ts">{formatTs(n.created_at)}</div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

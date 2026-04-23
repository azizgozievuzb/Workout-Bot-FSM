import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { getFeed, markAsRead } from '../../api/activityFeed';
import type { FeedItem } from '../../api/activityFeed';
import { getUnreadCount } from '../../api/notifications';
import { NotificationList } from '../bond/NotificationList';
import RoleTransition from '../shared/RoleTransition';
import '../../styles/cubes.css';

type ActiveView = 'player' | 'responsible';

const EVENT_ICONS: Record<string, string> = {
    workout_done: '💪',
    streak_lost: '💔',
    shop_purchase: '🛒',
    boost_activated: '⚡',
    ping: '🔔',
    milestone: '🏆',
};

function feedText(item: FeedItem): string {
    const p = item.payload || {};
    switch (item.event_type) {
        case 'workout_done': return `${p.player_name || 'Игрок'} завершил тренировку ${p.score ? `+${p.score}` : ''}`;
        case 'streak_lost': return `${p.player_name || 'Игрок'} потерял стрик`;
        case 'shop_purchase': return `${p.player_name || 'Игрок'} купил ${p.item_name || 'предмет'}`;
        case 'boost_activated': return `Буст X2 активирован${p.hours ? ` на ${p.hours}ч` : ''}`;
        case 'ping': return `Пинг от ${p.sender_name || 'партнёра'}`;
        case 'milestone': return `Достижение: ${p.title || 'новое'}`;
        default: return item.event_type;
    }
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}ч назад`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Вчера';
    return `${days} дн назад`;
}

/* ---------- NOTIFICATIONS SECTION ---------- */

const NotificationsSection: React.FC = () => {
    const { unreadNotifications, setUnreadNotifications } = useAuthStore();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const refresh = () => {
            getUnreadCount().then(setUnreadNotifications).catch(() => {});
        };
        refresh();
        const handler = () => { if (document.visibilityState === 'visible') refresh(); };
        document.addEventListener('visibilitychange', handler);
        return () => document.removeEventListener('visibilitychange', handler);
    }, [setUnreadNotifications]);

    return (
        <div className="notif-section">
            <button
                className="notif-section-header"
                onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            >
                <span>🔔 Уведомления</span>
                {unreadNotifications > 0 && (
                    <span className="notif-badge">
                        {unreadNotifications > 99 ? '99+' : unreadNotifications}
                    </span>
                )}
                <span className="notif-section-chevron">{open ? '▲' : '▼'}</span>
            </button>
            {open && <NotificationList />}
        </div>
    );
};

const BondCube: React.FC = () => {
    const { primary_role, has_player_access, has_responsible_access, is_admin, activeRoleView, setActiveRoleView } = useAuthStore();
    const user: DualRoleUser = {
        primary_role: primary_role || 'player',
        has_player_access,
        has_responsible_access,
        is_admin,
    };

    const defaultView: ActiveView = canPlay(user) ? 'player' : 'responsible';
    const persistedAllowed = activeRoleView
        && (activeRoleView === 'player' ? canPlay(user) : canMonitor(user));
    const view: ActiveView = persistedAllowed ? (activeRoleView as ActiveView) : defaultView;
    const dual = isDualRole(user);

    const toggleView = () => setActiveRoleView(view === 'player' ? 'responsible' : 'player');

    return (
        <div className="cube-module">
            <NotificationsSection />
            <RoleTransition
                view={view}
                dual={dual}
                onToggle={toggleView}
                lockedMessage={view === 'player'
                    ? 'Введите промокод чтобы разблокировать'
                    : 'Вам нужна пригласительная ссылка'}
            >
                {view === 'player' ? (
                    canPlay(user) ? <PlayerBond /> : <LockedPlayer />
                ) : (
                    canMonitor(user) ? <ResponsibleBond /> : <LockedResponsible />
                )}
            </RoleTransition>
        </div>
    );
};

/* ---------- PLAYER BOND ---------- */

const PlayerBond: React.FC = () => {
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getFeed(20, 0)
            .then((res) => {
                setFeed(res.items);
                const unread = res.items.filter(i => !i.is_read).map(i => i.id);
                if (unread.length > 0) markAsRead(unread).catch(() => {});
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    return (
        <>
            <div className="cube-section-title">Лента</div>

            {loading ? (
                <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>
            ) : feed.length === 0 ? (
                <div className="cube-locked">
                    <div className="cube-locked-text">Пока нет событий</div>
                </div>
            ) : (
                feed.map(item => (
                    <div className="cube-feed-card" key={item.id}>
                        <div className="cube-feed-icon">{EVENT_ICONS[item.event_type] || '📌'}</div>
                        <div>
                            <div className="cube-feed-text">{feedText(item)}</div>
                            <div className="cube-feed-time">{timeAgo(item.created_at)}</div>
                        </div>
                    </div>
                ))
            )}

            <button className="cube-btn-secondary" onClick={(e) => e.stopPropagation()}>
                Профиль и настройки
            </button>
        </>
    );
};

/* ---------- RESPONSIBLE BOND ---------- */

const ResponsibleBond: React.FC = () => {
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getFeed(20, 0)
            .then((res) => {
                setFeed(res.items);
                const unread = res.items.filter(i => !i.is_read).map(i => i.id);
                if (unread.length > 0) markAsRead(unread).catch(() => {});
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    return (
        <>
            <div className="cube-section-title">Лента игроков</div>

            {loading ? (
                <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>
            ) : feed.length === 0 ? (
                <div className="cube-locked">
                    <div className="cube-locked-text">Пока нет событий</div>
                </div>
            ) : (
                feed.map(item => (
                    <div className="cube-feed-card" key={item.id}>
                        <div className="cube-feed-icon">{EVENT_ICONS[item.event_type] || '📌'}</div>
                        <div>
                            <div className="cube-feed-text">{feedText(item)}</div>
                            <div className="cube-feed-time">{timeAgo(item.created_at)}</div>
                        </div>
                    </div>
                ))
            )}

            <button className="cube-btn-secondary" onClick={(e) => e.stopPropagation()}>
                Связь
            </button>

            <button className="cube-btn-secondary" onClick={(e) => e.stopPropagation()}>
                Настройки уведомлений
            </button>

            <button className="cube-btn-secondary" onClick={(e) => e.stopPropagation()}>
                Подписка и биллинг
            </button>
        </>
    );
};

/* ---------- LOCKED ---------- */

const LockedPlayer: React.FC = () => (
    <div className="cube-locked">
        <div className="cube-locked-icon">P</div>
        <div className="cube-locked-title">Связь Игрока</div>
        <div className="cube-locked-text">
            Вам нужна пригласительная ссылка, чтобы видеть ленту активности.
        </div>
    </div>
);

const LockedResponsible: React.FC = () => (
    <div className="cube-locked">
        <div className="cube-locked-icon">R</div>
        <div className="cube-locked-title">Связь Ответственного</div>
        <div className="cube-locked-text">
            Введите промокод, чтобы следить за активностью ваших игроков.
        </div>
    </div>
);

export default BondCube;

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { getFeed, markAsRead } from '../../api/activityFeed';
import type { FeedItem } from '../../api/activityFeed';
import { getUnreadCount } from '../../api/notifications';
import { NotificationList } from '../bond/NotificationList';
import RoleTransition from '../shared/RoleTransition';
import RenewalScreen from '../shared/RenewalScreen';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import { createInvite, listInvites, deleteInvite } from '../../api/invites';
import type { Invite } from '../../api/invites';
import { playerAvatarUrl } from '../../utils/playerAvatar';
import { useTheme } from '../../contexts/ThemeContext';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
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
                    ? 'Вам нужна пригласительная ссылка от наставника'
                    : 'Оформите подписку, чтобы приглашать игроков'}
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

/* ---------- INVITES PANEL (Мои игроки) ---------- */

// Slot-full upsell by the Responsible's own tier (elite is the ceiling).
const SLOT_FULL_MSG: Record<string, string> = {
    standard: 'Все слоты заняты. Больше игроков — на тарифе Premium (до 2) или Elite (до 3)',
    premium: 'Все слоты заняты. Больше игроков — на тарифе Elite (до 3)',
    elite: 'Все слоты тарифа заняты',
};

const InvitesPanel: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
    const theme = useTheme();
    const ownAccessTier = useAuthStore((s) => s.ownAccessTier);
    const [players, setPlayers] = useState<MyPlayer[]>([]);
    const [invites, setInvites] = useState<Invite[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [toast, setToast] = useState('');

    useEffect(() => {
        Promise.all([getMyPlayers().catch(() => []), listInvites().catch(() => [])])
            .then(([p, i]) => { setPlayers(p); setInvites(i); })
            .finally(() => setLoading(false));
    }, [refreshKey]);

    const addPlayer = async () => {
        if (busy) return;
        setBusy(true);
        setErr('');
        try {
            const inv = await createInvite();
            setInvites((prev) => [inv, ...prev]);
            hapticNotification('success');
            const tg = (window as any).Telegram?.WebApp;
            const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inv.link)}&text=${encodeURIComponent('Приглашаю тебя тренироваться в Workout Bot!')}`;
            if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
            else if (navigator.clipboard) { await navigator.clipboard.writeText(inv.link); setToast('Ссылка скопирована'); }
        } catch (e: any) {
            const d = e?.response?.data?.detail;
            const code = typeof d === 'object' ? d?.code : d;
            setErr(
                code === 'SLOT_FULL' ? (SLOT_FULL_MSG[ownAccessTier ?? 'standard'] ?? 'Все слоты тарифа заняты')
                    : code === 'SUBSCRIPTION_INACTIVE' ? 'Подписка неактивна — продлите её'
                        : 'Не удалось создать приглашение',
            );
            hapticNotification('error');
        } finally {
            setBusy(false);
            setTimeout(() => setToast(''), 2500);
        }
    };

    const copyLink = async (link: string) => {
        try { await navigator.clipboard.writeText(link); setToast('Ссылка скопирована'); setTimeout(() => setToast(''), 2000); } catch { /* ignore */ }
    };

    const shareLink = (link: string) => {
        const tg = (window as any).Telegram?.WebApp;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Приглашаю тебя тренироваться в Workout Bot!')}`;
        if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
        else copyLink(link);
    };

    const removeInvite = async (id: string) => {
        hapticImpact('light');
        try { await deleteInvite(id); setInvites((prev) => prev.filter((x) => x.id !== id)); } catch { /* ignore */ }
    };

    const pending = invites.filter((i) => i.status === 'pending');

    return (
        <div style={{ marginBottom: 16 }}>
            <div className="cube-section-title">Мои игроки</div>

            {loading ? (
                <div style={{ textAlign: 'center', opacity: 0.6, padding: 8 }}>Загрузка…</div>
            ) : players.length === 0 ? (
                <div style={{ opacity: 0.6, fontSize: 13, padding: '4px 0 8px' }}>Пока нет игроков.</div>
            ) : (
                players.map((p) => {
                    const avatar = playerAvatarUrl(p, theme);
                    return (
                        <div key={p.id} className="cube-feed-card">
                            <div className="cube-avatar">
                                {avatar
                                    ? <img src={avatar} alt={p.first_name ?? 'Игрок'} />
                                    : (p.first_name ?? 'И').charAt(0)}
                            </div>
                            <div><div className="cube-feed-text">{p.first_name ?? 'Игрок'}</div></div>
                        </div>
                    );
                })
            )}

            {pending.length > 0 && (
                <>
                    <div className="cube-section-title" style={{ marginTop: 10 }}>Приглашения</div>
                    {pending.map((inv) => (
                        <div key={inv.id} className="cube-feed-card" style={{ gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="cube-feed-text">Приглашение</div>
                                <div className="cube-feed-time">ожидает</div>
                            </div>
                            <button className="cube-btn-secondary" style={{ width: 'auto', padding: '4px 10px' }} onClick={(e) => { e.stopPropagation(); shareLink(inv.link); }}>Поделиться</button>
                            <button className="cube-btn-secondary" style={{ width: 'auto', padding: '4px 10px' }} onClick={(e) => { e.stopPropagation(); copyLink(inv.link); }}>Копировать</button>
                            <button className="cube-btn-secondary" style={{ width: 'auto', padding: '4px 10px' }} onClick={(e) => { e.stopPropagation(); removeInvite(inv.id); }}>✕</button>
                        </div>
                    ))}
                </>
            )}

            {err && <div style={{ color: '#e74c3c', fontSize: 13, marginTop: 6 }}>{err}</div>}
            {toast && <div style={{ color: '#2ecc71', fontSize: 13, marginTop: 6 }}>{toast}</div>}

            <button className="cube-btn-secondary" onClick={(e) => { e.stopPropagation(); addPlayer(); }} disabled={busy}>
                ➕ Добавить игрока
            </button>
        </div>
    );
};

/* ---------- RESPONSIBLE BOND ---------- */

const ResponsibleBond: React.FC = () => {
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [showBilling, setShowBilling] = useState(false);
    // Bumped when the billing overlay closes → InvitesPanel refetches «Мои игроки»
    // (a downgrade with eviction changes the list).
    const [playersRefreshKey, setPlayersRefreshKey] = useState(0);

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
            <InvitesPanel refreshKey={playersRefreshKey} />

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

            <button className="cube-btn-secondary" onClick={(e) => { e.stopPropagation(); setShowBilling(true); }}>
                Подписка и биллинг
            </button>

            {showBilling && <RenewalScreen onClose={() => { setShowBilling(false); setPlayersRefreshKey((k) => k + 1); }} />}
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
            Оформите подписку, чтобы приглашать игроков и следить за их активностью.
        </div>
    </div>
);

export default BondCube;

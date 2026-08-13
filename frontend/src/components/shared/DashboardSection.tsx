import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type DashboardModule = 'Action' | 'Market' | 'Bond' | 'Admin';
export type DashboardView = 'player' | 'responsible' | 'admin';

export interface DashboardData {
    // Player
    current_streak?: number;
    drops_balance?: number;
    rest_days_remaining?: number;
    // Responsible
    players_count?: number;
    // Shared
    unread_count?: number;
}

interface MenuItem {
    icon: string;
    label: string;
    key: string;
    accent?: boolean;
}

interface DashboardSectionProps {
    module: DashboardModule;
    view: DashboardView;
    data: DashboardData;
    loading?: boolean;
    onOpen: (sub?: string) => void;
}

function pluralDays(n: number): string {
    if (n % 10 === 1 && n % 100 !== 11) return 'день';
    if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'дня';
    return 'дней';
}

function buildPrimary(module: DashboardModule, view: DashboardView, d: DashboardData, loading: boolean): MenuItem[] {
    const dash = loading ? '…' : '—';

    if (module === 'Action') {
        if (view === 'player') {
            const streak = d.current_streak ?? null;
            return [
                { icon: '\u{1F3CB}\u{FE0F}', label: 'Начать тренировку', key: 'workout', accent: true },
                { icon: '\u{1F525}', label: streak !== null ? `${streak} ${pluralDays(streak)}` : dash, key: 'streak' },
            ];
        }
        if (view === 'responsible') {
            const cnt = d.players_count ?? null;
            return [
                { icon: '\u{1F465}', label: 'Мои игроки', key: 'players', accent: true },
                { icon: '\u{1F4CD}', label: cnt !== null ? `${cnt}` : dash, key: 'players-count' },
            ];
        }
        return [{ icon: '\u{1F3CB}\u{FE0F}', label: 'Открыть', key: 'action', accent: true }];
    }

    if (module === 'Market') {
        if (view === 'player') {
            const bal = d.drops_balance ?? null;
            return [
                /* S64-9\u0431: \u044D\u0442\u043E \u041A\u0410\u041F\u041B\u0418 \u0438\u0433\u0440\u043E\u043A\u0430 (\u0442\u0440\u0443\u0434), \u0430 \u043D\u0435 Stars \u043D\u0430\u0441\u0442\u0430\u0432\u043D\u0438\u043A\u0430 (\u0434\u0435\u043D\u044C\u0433\u0438) \u2014
                   \u2B50 \u043D\u0430 \u044D\u0442\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0435 \u043F\u0443\u0442\u0430\u043B \u0434\u0432\u0435 \u0432\u0430\u043B\u044E\u0442\u044B. \u0423 \u0441\u0442\u0440\u043E\u043A\u0438 \u043D\u0430\u0441\u0442\u0430\u0432\u043D\u0438\u043A\u0430 \u043D\u0438\u0436\u0435
                   \u2B50 \u0437\u0430\u043A\u043E\u043D\u043D\u0430: \u0442\u0430\u043C \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u043E Stars. */
                { icon: '\u{1F4A7}', label: bal !== null ? `${bal}` : dash, key: 'balance' },
                { icon: '\u{1F6D2}', label: 'Магазин', key: 'shop', accent: true },
            ];
        }
        if (view === 'responsible') {
            return [
                { icon: '\u{1F381}', label: 'Подарить', key: 'gift', accent: true },
                { icon: '\u2B50', label: 'Пополнить', key: 'topup' },
            ];
        }
        return [{ icon: '\u{1F6D2}', label: 'Магазин', key: 'shop', accent: true }];
    }

    if (module === 'Bond') {
        const unread = d.unread_count ?? null;
        const unreadLabel = unread !== null ? (unread > 0 ? `${unread} новых` : 'Нет новых') : dash;
        if (view === 'player') {
            return [
                { icon: '\u{1F4F0}', label: unreadLabel, key: 'feed' },
                { icon: '\u{1F464}', label: 'Профиль', key: 'profile' },
            ];
        }
        if (view === 'responsible') {
            return [
                { icon: '\u{1F4F0}', label: unreadLabel, key: 'feed' },
                { icon: '\u{1F517}', label: 'Связь', key: 'bond' },
            ];
        }
        return [{ icon: '\u{1F4F0}', label: unreadLabel, key: 'feed' }];
    }

    // Admin
    return [
        { icon: '\u{1F511}', label: 'Промокоды', key: 'promos', accent: true },
        { icon: '\u{1F4CA}', label: 'Статистика', key: 'admin-stats' },
    ];
}

const MORE_ITEMS: Record<DashboardModule, MenuItem[]> = {
    Action: [
        { icon: '\u{1F4CA}', label: 'Статистика дня', key: 'stats' },
        { icon: '\u{1F634}', label: 'День отдыха', key: 'rest' },
    ],
    Market: [
        { icon: '\u{1F381}', label: 'Лутбоксы', key: 'lootbox' },
    ],
    Bond: [
        { icon: '\u{1F3C6}', label: 'Достижения', key: 'achievements' },
        { icon: '\u2699\u{FE0F}', label: 'Настройки', key: 'settings' },
    ],
    Admin: [
        { icon: '\u{1F465}', label: 'Пользователи', key: 'users' },
        { icon: '\u{1F4B0}', label: 'Биллинг', key: 'billing' },
    ],
};

const DashboardSection: React.FC<DashboardSectionProps> = ({ module, view, data, loading = false, onOpen }) => {
    const [moreOpen, setMoreOpen] = useState(false);

    const handleItem = useCallback((e: React.MouseEvent, key: string) => {
        e.stopPropagation();
        onOpen(key);
    }, [onOpen]);

    const handleMore = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setMoreOpen(prev => !prev);
    }, []);

    const primary = buildPrimary(module, view, data, loading);
    const more = MORE_ITEMS[module];

    return (
        <div className="dashboard-section">
            <div className="dashboard-section-title">{module}</div>
            <div className="dashboard-primary">
                {primary.map(item => (
                    <div
                        key={item.key}
                        className={`dashboard-primary-item ${item.accent ? 'accent' : ''}`}
                        onClick={(e) => handleItem(e, item.key)}
                    >
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                    </div>
                ))}
            </div>
            {more.length > 0 && (
                <>
                    <div className="dashboard-more-toggle" onClick={handleMore}>
                        Ещё <span className={`dashboard-section-arrow ${moreOpen ? 'open' : ''}`}>&#x25BC;</span>
                    </div>
                    <AnimatePresence>
                        {moreOpen && (
                            <motion.div
                                className="dashboard-dropdown"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: 'easeInOut' }}
                                style={{ overflow: 'hidden' }}
                            >
                                {more.map(item => (
                                    <div
                                        key={item.key}
                                        className="dashboard-dropdown-item"
                                        onClick={(e) => handleItem(e, item.key)}
                                    >
                                        <span>{item.icon}</span>
                                        <span>{item.label}</span>
                                    </div>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </>
            )}
        </div>
    );
};

export default DashboardSection;

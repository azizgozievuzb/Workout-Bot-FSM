import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor } from '../../utils/roles';
import DashboardSection from './DashboardSection';
import type { DashboardModule, DashboardView, DashboardData } from './DashboardSection';
import { getMyStats, getPartnerStats } from '../../api/stats';
import { getUnreadCount } from '../../api/activityFeed';

interface DashboardPanelProps {
    onOpen: (module: DashboardModule, sub?: string) => void;
}

const DashboardPanel: React.FC<DashboardPanelProps> = ({ onOpen }) => {
    const { primary_role, has_player_access, has_responsible_access, is_admin, activeRoleView } = useAuthStore();
    const user: DualRoleUser = {
        primary_role: primary_role || 'player',
        has_player_access,
        has_responsible_access,
        is_admin,
    };

    const defaultView: DashboardView = canPlay(user) ? 'player' : canMonitor(user) ? 'responsible' : 'player';
    const persistedAllowed = activeRoleView
        && (activeRoleView === 'player' ? canPlay(user) : canMonitor(user));
    const view: DashboardView = persistedAllowed ? (activeRoleView as DashboardView) : defaultView;

    const [data, setData] = useState<DashboardData>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const tasks: Promise<void>[] = [];

        if (view === 'player' && canPlay(user)) {
            tasks.push(
                getMyStats()
                    .then(s => {
                        if (cancelled) return;
                        setData(prev => ({
                            ...prev,
                            current_streak: s.current_streak,
                            star_balance: s.star_balance,
                            rest_days_remaining: s.rest_days_remaining,
                        }));
                    })
                    .catch(() => {})
            );
        }

        if (view === 'responsible' && canMonitor(user)) {
            tasks.push(
                getPartnerStats()
                    .then(ps => {
                        if (cancelled) return;
                        setData(prev => ({ ...prev, players_count: ps.length }));
                    })
                    .catch(() => {})
            );
        }

        tasks.push(
            getUnreadCount()
                .then(c => {
                    if (cancelled) return;
                    setData(prev => ({ ...prev, unread_count: c }));
                })
                .catch(() => {})
        );

        Promise.allSettled(tasks).then(() => {
            if (!cancelled) setLoading(false);
        });

        return () => { cancelled = true; };
    }, [view, has_player_access, has_responsible_access]);

    const modules: DashboardModule[] = is_admin
        ? ['Action', 'Market', 'Bond', 'Admin']
        : ['Action', 'Market', 'Bond'];

    return (
        <div className="dashboard-panel">
            {modules.map((mod, i, arr) => (
                <React.Fragment key={mod}>
                    <DashboardSection
                        module={mod}
                        view={mod === 'Admin' ? 'admin' : view}
                        data={data}
                        loading={loading}
                        onOpen={(sub) => onOpen(mod, sub)}
                    />
                    {i < arr.length - 1 && <div className="dashboard-divider" />}
                </React.Fragment>
            ))}
        </div>
    );
};

export default DashboardPanel;

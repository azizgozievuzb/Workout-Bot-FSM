import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import PromoCodeModal from './PromoCodeModal';

/**
 * Global role-switch button for Dashboard overlay.
 * Positioned opposite the close X (top-left).
 * Toggles activeRoleView in zustand. Same visual style as RoleTransition orb.
 */
const DashboardRoleSwitch: React.FC = () => {
    const { primary_role, has_player_access, has_responsible_access, is_admin, activeRoleView, setActiveRoleView } = useAuthStore();
    const user: DualRoleUser = {
        primary_role: primary_role || 'player',
        has_player_access,
        has_responsible_access,
        is_admin,
    };

    const defaultView: 'player' | 'responsible' = canPlay(user) ? 'player' : 'responsible';
    const persistedAllowed = activeRoleView
        && (activeRoleView === 'player' ? canPlay(user) : canMonitor(user));
    const view: 'player' | 'responsible' = persistedAllowed ? (activeRoleView as 'player' | 'responsible') : defaultView;
    const dual = isDualRole(user);

    const [promoOpen, setPromoOpen] = useState(false);
    const [denied, setDenied] = useState(false);

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!dual) {
            setDenied(true);
            setPromoOpen(true);
            setTimeout(() => setDenied(false), 2000);
            return;
        }
        setActiveRoleView(view === 'player' ? 'responsible' : 'player');
    };

    return (
        <>
            <button
                className={`rt-btn ${dual ? 'rt-dual' : 'rt-single'} ${denied ? 'rt-denied' : ''} dashboard-role-switch`}
                onClick={handleClick}
                aria-label="Сменить роль"
            >
                <span className="rt-letter">{view === 'player' ? 'P' : 'R'}</span>
                <span className="rt-ring" />
            </button>

            <PromoCodeModal
                open={promoOpen}
                onClose={() => setPromoOpen(false)}
                targetRole={view === 'player' ? 'responsible' : 'player'}
                onSuccess={() => {
                    setPromoOpen(false);
                    setActiveRoleView(view === 'player' ? 'responsible' : 'player');
                }}
            />
        </>
    );
};

export default DashboardRoleSwitch;

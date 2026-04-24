import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import TierBadge from '../common/TierBadge';
import type { AccessTier } from '../../stores/authStore';
import { hapticNotification } from '../../utils/haptic';
import './TierMatrixScreen.css';

interface Props {
    onClose: () => void;
}

interface Feature {
    label: string;
    minTier: AccessTier;
}

const TIER_RANK: Record<AccessTier, number> = { standard: 0, premium: 1, elite: 2 };
const TIER_LABEL: Record<AccessTier, string> = { standard: 'Стандарт', premium: 'Премиум', elite: 'Элит' };
const TIERS: AccessTier[] = ['standard', 'premium', 'elite'];

const FEATURES: Feature[] = [
    { label: 'Фича 1', minTier: 'standard' },
    { label: 'Фича 2', minTier: 'standard' },
    { label: 'Фича 3', minTier: 'standard' },
    { label: 'Фича 4', minTier: 'standard' },
    { label: 'Фича 5', minTier: 'premium' },
    { label: 'Фича 6', minTier: 'premium' },
    { label: 'Фича 7', minTier: 'elite' },
    { label: 'Фича 8', minTier: 'elite' },
];

const TierMatrixScreen: React.FC<Props> = ({ onClose }) => {
    const effectiveTier = useAuthStore((s) => s.effectiveTier());
    const [toast, setToast] = useState('');

    const handleUpgrade = (e: React.MouseEvent) => {
        e.stopPropagation();
        hapticNotification('warning');
        setToast('Скоро: трата XP за повышение тира');
        setTimeout(() => setToast(''), 3500);
    };

    return (
        <div className="tier-matrix-screen" onClick={(e) => e.stopPropagation()}>
            <div className="tier-matrix-header">
                <button className="tier-matrix-back" onClick={onClose}>←</button>
                <h2 className="tier-matrix-title">Тарифы</h2>
            </div>

            <div className="tier-matrix-body">
                <div className="tier-matrix-cols">
                    {TIERS.map((tier) => {
                        const isActive = tier === effectiveTier;
                        const isUpgradeable = TIER_RANK[tier] > TIER_RANK[effectiveTier];
                        return (
                            <div
                                key={tier}
                                className={`tier-col${isActive ? ' tier-col--active' : ''}`}
                            >
                                <div className="tier-col-header">
                                    <TierBadge tier={tier} />
                                    <span className="tier-col-name">{TIER_LABEL[tier]}</span>
                                </div>

                                <ul className="tier-col-features">
                                    {FEATURES.map((f) => {
                                        const on = TIER_RANK[tier] >= TIER_RANK[f.minTier];
                                        return (
                                            <li
                                                key={f.label}
                                                className={`tier-col-feature${on ? ' tier-col-feature--on' : ' tier-col-feature--off'}`}
                                            >
                                                <span className="tier-col-feature-dot">{on ? '●' : '○'}</span>
                                                {f.label}
                                            </li>
                                        );
                                    })}
                                </ul>

                                <div className="tier-col-footer">
                                    {isActive && (
                                        <div className="tier-col-current">Текущий</div>
                                    )}
                                    {isUpgradeable && (
                                        <button className="tier-col-upgrade-btn" onClick={handleUpgrade}>
                                            ⬆️ Попросить повышение
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {toast && <div className="tier-matrix-toast">{toast}</div>}
        </div>
    );
};

export default TierMatrixScreen;

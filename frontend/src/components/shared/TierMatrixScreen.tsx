import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import TierBadge from '../common/TierBadge';
import type { AccessTier } from '../../stores/authStore';
import './TierMatrixScreen.css';

interface Props {
    onClose: () => void;
}

interface MatrixRow {
    label: string;
    standard: string;
    premium: string;
    elite: string;
}

const CHECK = '✓';
const CROSS = '—';

const ROWS: MatrixRow[] = [
    { label: 'Игровых слотов',         standard: '1',     premium: '2',     elite: '3'    },
    { label: 'Стрик-заморозки',         standard: CHECK,   premium: CHECK,   elite: CHECK  },
    { label: 'Бонус-паки',              standard: CROSS,   premium: CHECK,   elite: CHECK  },
    { label: 'Подарок заморозок',       standard: CROSS,   premium: CHECK,   elite: CHECK  },
    { label: 'День отдыха (жен.)',       standard: CHECK,   premium: CHECK,   elite: CHECK  },
    { label: 'Приоритетная поддержка',  standard: CROSS,   premium: CROSS,   elite: CHECK  },
];

const TIERS: AccessTier[] = ['standard', 'premium', 'elite'];

const TierMatrixScreen: React.FC<Props> = ({ onClose }) => {
    const effectiveTier = useAuthStore((s) => s.effectiveTier());
    const [toast, setToast] = useState('');

    const handleChangeTier = (e: React.MouseEvent) => {
        e.stopPropagation();
        setToast('Обратитесь к администратору для смены тарифа');
        setTimeout(() => setToast(''), 3500);
    };

    const cellClass = (val: string, tier: AccessTier) => {
        const active = tier === effectiveTier ? ' tier-matrix-cell--active-col' : '';
        if (val === CHECK) return `tier-matrix-cell tier-matrix-cell--check${active}`;
        if (val === CROSS) return `tier-matrix-cell tier-matrix-cell--cross${active}`;
        return `tier-matrix-cell${active}`;
    };

    return (
        <div className="tier-matrix-screen" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="tier-matrix-header">
                <button className="tier-matrix-back" onClick={onClose}>←</button>
                <h2 className="tier-matrix-title">Тарифы</h2>
            </div>

            {/* Table */}
            <div className="tier-matrix-body">
                <div className="tier-matrix-table">
                    {/* Column headers */}
                    <div className="tier-matrix-col-header-label" />
                    {TIERS.map((tier) => (
                        <div
                            key={tier}
                            className={`tier-matrix-col-header-cell${tier === effectiveTier ? ' tier-matrix-col-header-cell--active' : ''}`}
                        >
                            <TierBadge tier={tier} />
                            <span className="tier-matrix-col-name">
                                {tier === 'standard' ? 'Стандарт' : tier === 'premium' ? 'Премиум' : 'Элит'}
                            </span>
                        </div>
                    ))}

                    {/* Data rows */}
                    {ROWS.map((row) => (
                        <React.Fragment key={row.label}>
                            <div className="tier-matrix-cell-label">{row.label}</div>
                            {TIERS.map((tier) => (
                                <div key={tier} className={cellClass(row[tier], tier)}>
                                    {row[tier]}
                                </div>
                            ))}
                        </React.Fragment>
                    ))}
                </div>
            </div>

            {/* Footer */}
            <div className="tier-matrix-footer">
                <button className="tier-matrix-change-btn" onClick={handleChangeTier}>
                    Сменить тариф
                </button>
                {toast && <div className="tier-matrix-toast">{toast}</div>}
            </div>
        </div>
    );
};

export default TierMatrixScreen;

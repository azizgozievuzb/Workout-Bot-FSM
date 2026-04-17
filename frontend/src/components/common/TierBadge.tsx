import React from 'react';
import type { AccessTier } from '../../api/promo';

const TIER_STYLES: Record<AccessTier, { bg: string; color: string; label: string }> = {
    standard: { bg: '#e0e0e0', color: '#424242', label: 'STD' },
    premium:  { bg: '#ffd54f', color: '#5d4037', label: 'PRM' },
    elite:    { bg: '#7c4dff', color: '#ffffff', label: 'ELT' },
};

interface TierBadgeProps {
    tier: AccessTier;
}

const TierBadge: React.FC<TierBadgeProps> = ({ tier }) => {
    const s = TIER_STYLES[tier] ?? TIER_STYLES.standard;
    return (
        <span className="tier-badge" style={{ background: s.bg, color: s.color }}>
            {s.label}
        </span>
    );
};

export default TierBadge;

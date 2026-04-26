import React, { useState, useEffect, useCallback } from 'react';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import { applyTierChangeWithEvictions } from '../../api/admin';
import type { AccessTier } from '../../api/promo';

const TIER_PLAYER_LIMITS: Record<AccessTier, number> = {
    standard: 1,
    premium: 2,
    elite: 3,
};

interface Props {
    targetTier: AccessTier;
    promoCode: string;
    onClose: () => void;
    onSuccess: () => void;
}

const TierDowngradeModal: React.FC<Props> = ({ targetTier, promoCode, onClose, onSuccess }) => {
    const [players, setPlayers] = useState<MyPlayer[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const maxAllowed = TIER_PLAYER_LIMITS[targetTier] ?? 1;
    const mustEvict = Math.max(0, players.length - maxAllowed);
    const canApply = selected.size >= mustEvict && !submitting;

    useEffect(() => {
        hapticImpact('medium');
        getMyPlayers()
            .then(setPlayers)
            .catch(() => setError('Не удалось загрузить список игроков'))
            .finally(() => setLoading(false));
    }, []);

    const toggle = useCallback((id: string) => {
        hapticImpact('light');
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleApply = useCallback(async () => {
        if (!canApply) return;
        setSubmitting(true);
        setError(null);
        try {
            await applyTierChangeWithEvictions({
                new_tier_code: promoCode,
                player_ids_to_evict: Array.from(selected),
            });
            hapticNotification('success');
            onSuccess();
        } catch (e: any) {
            hapticNotification('error');
            const detail = e?.response?.data?.detail;
            setError(
                typeof detail === 'string'
                    ? detail
                    : detail?.code ?? 'Ошибка при смене тарифа',
            );
        } finally {
            setSubmitting(false);
        }
    }, [canApply, promoCode, selected, onSuccess]);

    return (
        <div
            className="cube-modal-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="cube-modal-sheet tier-change-modal-sheet"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="cube-modal-handle" />
                <div className="cube-modal-title">Смена тарифа → {targetTier}</div>
                <div className="cube-modal-body">
                    <p style={{ marginBottom: 8 }}>
                        Тариф <b>{targetTier}</b> позволяет максимум <b>{maxAllowed}</b> игрок(а).
                        Выберите <b>{mustEvict}</b> для удаления:
                    </p>

                    {loading && <div style={{ textAlign: 'center', padding: 16 }}>Загрузка...</div>}

                    {!loading && players.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>
                            Нет игроков
                        </div>
                    )}

                    {!loading && players.map(p => (
                        <label
                            key={p.id}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '10px 0',
                                borderBottom: '1px solid rgba(255,255,255,0.08)',
                                cursor: 'pointer',
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={selected.has(p.id)}
                                onChange={() => toggle(p.id)}
                                style={{ width: 18, height: 18, accentColor: '#e74c3c' }}
                            />
                            <span style={{ flex: 1 }}>
                                {p.first_name ?? 'Игрок'}
                                {p.is_expired && (
                                    <span style={{ opacity: 0.5, fontSize: 12, marginLeft: 6 }}>
                                        (истёк)
                                    </span>
                                )}
                            </span>
                        </label>
                    ))}

                    {error && (
                        <div style={{ color: '#e74c3c', marginTop: 8, fontSize: 13 }}>{error}</div>
                    )}
                </div>

                <div className="cube-modal-actions">
                    <button
                        type="button"
                        className="cube-modal-btn cube-modal-btn--secondary"
                        onClick={onClose}
                        disabled={submitting}
                    >
                        Отмена
                    </button>
                    <button
                        type="button"
                        className="cube-modal-btn cube-modal-btn--primary"
                        onClick={handleApply}
                        disabled={!canApply}
                        style={{ background: canApply ? '#e74c3c' : undefined }}
                    >
                        {submitting ? 'Применяю...' : `Применить (удалить ${selected.size})`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TierDowngradeModal;

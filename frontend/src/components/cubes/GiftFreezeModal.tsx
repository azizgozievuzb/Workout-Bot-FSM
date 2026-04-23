import React, { useCallback, useEffect, useRef, useState } from 'react';
import { giftFreeze } from '../../api/shop';
import { useAuthStore } from '../../stores/authStore';
import { hapticImpact, hapticNotification } from '../../utils/haptic';

interface Props {
    targetUserId: string;
    playerName: string | null;
    onClose: () => void;
    onSuccess: (message: string) => void;
}

const GiftFreezeModal: React.FC<Props> = ({ targetUserId, playerName, onClose, onSuccess }) => {
    const giftBalance = useAuthStore((s) => s.giftFreezeBalance);
    const setGiftBalance = useAuthStore((s) => s.setGiftFreezeBalance);

    const max = Math.max(0, giftBalance);
    const [amount, setAmount] = useState<number>(max > 0 ? 1 : 0);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const touchStartY = useRef(0);

    useEffect(() => { hapticImpact('light'); }, []);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
    }, []);
    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const delta = e.changedTouches[0].clientY - touchStartY.current;
        if (delta > 80) onClose();
    }, [onClose]);

    const canSubmit = max > 0 && amount >= 1 && amount <= max && !submitting;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError('');
        hapticImpact('medium');
        try {
            const res = await giftFreeze({ player_id: targetUserId, freeze_count: amount });
            setGiftBalance(res.new_gift_freeze_balance);
            hapticNotification('success');
            onSuccess('Отправлено');
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            const errCode = typeof detail === 'object' ? detail?.code : detail;
            const msg = errCode === 'INSUFFICIENT_BALANCE'
                ? 'Недостаточно подарочных заморозок'
                : 'Не удалось отправить.';
            setError(msg);
            hapticNotification('error');
            setSubmitting(false);
        }
    };

    return (
        <div
            className="cube-modal-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="cube-modal-sheet gift-freeze-modal-sheet"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="cube-modal-handle" />
                <div className="cube-modal-title">Подарить заморозку</div>
                {playerName && (
                    <div className="cube-modal-subtitle">Игрок: {playerName}</div>
                )}
                <form onSubmit={handleSubmit} className="cube-modal-form">
                    {max === 0 ? (
                        <div className="cube-modal-empty">Нет доступных подарков</div>
                    ) : (
                        <>
                            <label className="cube-modal-label">
                                Количество заморозок (макс. {max})
                            </label>
                            <input
                                className="cube-modal-input"
                                type="number"
                                min={1}
                                max={max}
                                value={amount}
                                onChange={(e) => {
                                    const v = parseInt(e.target.value, 10);
                                    if (Number.isNaN(v)) { setAmount(0); return; }
                                    setAmount(Math.max(1, Math.min(max, v)));
                                }}
                                autoFocus
                            />
                        </>
                    )}
                    {error && <div className="cube-modal-error">{error}</div>}
                    <div className="cube-modal-actions">
                        <button
                            type="button"
                            className="cube-modal-btn cube-modal-btn--ghost"
                            onClick={onClose}
                            disabled={submitting}
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            className="cube-modal-btn cube-modal-btn--primary"
                            disabled={!canSubmit}
                        >
                            {submitting ? 'Отправка...' : 'Подарить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default GiftFreezeModal;

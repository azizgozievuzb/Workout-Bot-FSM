import React, { useCallback, useEffect, useRef, useState } from 'react';
import { applyRenewalPlayer } from '../../api/promo';
import { hapticImpact, hapticNotification } from '../../utils/haptic';

interface Props {
    partnershipId: string;
    playerName: string | null;
    onClose: () => void;
    onSuccess: (addedDays: number) => void;
}

const RenewalModal: React.FC<Props> = ({ partnershipId, playerName, onClose, onSuccess }) => {
    const [code, setCode] = useState('');
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || submitting) return;
        setSubmitting(true);
        setError('');
        hapticImpact('medium');
        try {
            const res = await applyRenewalPlayer(partnershipId, code.trim());
            hapticNotification('success');
            onSuccess(res.added_days);
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            const errCode = typeof detail === 'object' ? detail?.code : detail;
            let msg = 'Не удалось активировать код.';
            if (errCode === 'CODE_INVALID') msg = 'Код не найден или уже использован.';
            else if (errCode === 'TIER_MISMATCH')
                msg = 'Этот код не подходит — уровень доступа не совпадает с tier Игрока.';
            else if (errCode === 'NOT_YOUR_PLAYER') msg = 'Это не ваш Игрок.';
            else if (errCode === 'RACE') msg = 'Код только что был использован. Попробуйте другой.';
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
                className="cube-modal-sheet renewal-modal-sheet"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="cube-modal-handle" />
                <div className="cube-modal-title">
                    Продление доступа{playerName ? ` — ${playerName}` : ''}
                </div>
                <form onSubmit={handleSubmit} className="cube-modal-form">
                    <input
                        className="cube-modal-input"
                        placeholder="Введите renewal-код"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        autoFocus
                        maxLength={32}
                    />
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
                            disabled={!code.trim() || submitting}
                        >
                            {submitting ? 'Активация...' : 'Активировать'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default RenewalModal;

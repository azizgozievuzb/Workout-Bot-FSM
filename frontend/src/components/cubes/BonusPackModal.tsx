import React, { useCallback, useEffect, useRef, useState } from 'react';
import { applyBonusPack } from '../../api/promo';
import { hapticImpact, hapticNotification } from '../../utils/haptic';

interface Props {
    onClose: () => void;
    onSuccess: (message: string) => void;
}

const BonusPackModal: React.FC<Props> = ({ onClose, onSuccess }) => {
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
            await applyBonusPack(code.trim());
            hapticNotification('success');
            onSuccess('Бонус применён');
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            const errCode = typeof detail === 'object' ? detail?.code : detail;
            let msg = 'Не удалось применить код.';
            if (errCode === 'INVALID_CODE' || errCode === 'CODE_INVALID') msg = 'Неверный код';
            else if (errCode === 'ALREADY_USED') msg = 'Код уже использован';
            else if (errCode === 'TIER_MISMATCH') msg = 'Код не подходит для этого тира';
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
                className="cube-modal-sheet bonus-pack-modal-sheet"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="cube-modal-handle" />
                <div className="cube-modal-title">Применить Bonus-Pack</div>
                <form onSubmit={handleSubmit} className="cube-modal-form">
                    <input
                        className="cube-modal-input"
                        placeholder="Введите Bonus-Pack код"
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
                            {submitting ? 'Применение...' : 'Применить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default BonusPackModal;

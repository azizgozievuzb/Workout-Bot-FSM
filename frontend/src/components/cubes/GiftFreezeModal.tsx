import React, { useCallback, useEffect, useRef, useState } from 'react';
import { giftFreeze } from '../../api/shelf';
import { hapticImpact, hapticNotification } from '../../utils/haptic';

/* Эконом-патч №1 (хвост 4): заморозка дарится ЗА КАПЛИ ИЗ ПУЛА наставника —
   ровно как соседняя кнопка дарения капель. Отдельного «запаса заморозок»
   (`gift_freeze_balance`) больше нет: пополнять его было нечем, и подарки
   уходили в мёртвую колонку. Количество не выбирается: за раз дарится одна,
   кап запаса игрока — 3 (гейт на бэке). */

interface Props {
    targetUserId: string;
    playerName: string | null;
    /** Цена дарения = цене заморозки в витрине игрока (анти-арбитраж Э.1). */
    price: number;
    /** Остаток пула наставника — чтобы показать, что останется после списания. */
    giftBalance: number;
    onClose: () => void;
    onSuccess: (message: string, newGiftBalance: number) => void;
}

const GiftFreezeModal: React.FC<Props> = ({
    targetUserId, playerName, price, giftBalance, onClose, onSuccess,
}) => {
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

    const enough = giftBalance >= price;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!enough || submitting) return;
        setSubmitting(true);
        setError('');
        hapticImpact('medium');
        try {
            const res = await giftFreeze(targetUserId);
            hapticNotification('success');
            onSuccess('❄️ Заморозка подарена', res.gift_balance);
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            const code = typeof detail === 'object' ? detail?.code : detail;
            setError(
                code === 'INSUFFICIENT_GIFT_BALANCE'
                    ? `В пуле только ${detail?.gift_balance ?? 0} 💧 — пополните`
                    : code === 'FREEZE_CAP'
                        ? 'У игрока запас заморозок уже полон'
                        : 'Не удалось подарить',
            );
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
                <div className="cube-modal-title">❄️ Подарить заморозку</div>
                {playerName && (
                    <div className="cube-modal-subtitle">Игрок: {playerName}</div>
                )}
                <form onSubmit={handleSubmit} className="cube-modal-form">
                    <div className="confirm-spend-line">
                        Спишется <b>{price} 💧</b> из пула
                        <span className="confirm-spend-rest">
                            {enough
                                ? `Останется ${giftBalance - price} 💧`
                                : `В пуле только ${giftBalance} 💧`}
                        </span>
                    </div>
                    <div className="cube-modal-body">
                        Заморозка спасёт стрик игрока в пропущенный плановый день.
                    </div>
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
                            disabled={!enough || submitting}
                        >
                            {submitting ? 'Дарим…' : 'Подарить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default GiftFreezeModal;

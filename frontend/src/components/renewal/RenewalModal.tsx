import React, { useState } from 'react';
import { renewPlayer } from '../../api/renewal';
import { hapticImpact, hapticNotification } from '../../utils/haptic';

interface Props {
    playerId: string;
    playerName: string | null;
    onClose: () => void;
    onSuccess: (addedDays: number) => void;
}

const RenewalModal: React.FC<Props> = ({ playerId, playerName, onClose, onSuccess }) => {
    const [code, setCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || submitting) return;
        setSubmitting(true);
        setError('');
        hapticImpact('medium');
        try {
            const res = await renewPlayer(playerId, code.trim());
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
        <div className="renewal-modal__backdrop" onClick={onClose}>
            <div className="renewal-modal" onClick={(e) => e.stopPropagation()}>
                <div className="renewal-modal__title">
                    Продление доступа{playerName ? ` — ${playerName}` : ''}
                </div>
                <form onSubmit={handleSubmit}>
                    <input
                        className="renewal-modal__input"
                        placeholder="Введите renewal-код"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        autoFocus
                        maxLength={32}
                    />
                    {error && <div className="renewal-modal__error">{error}</div>}
                    <div className="renewal-modal__actions">
                        <button
                            type="button"
                            className="renewal-modal__btn renewal-modal__btn--ghost"
                            onClick={onClose}
                            disabled={submitting}
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            className="renewal-modal__btn renewal-modal__btn--primary"
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

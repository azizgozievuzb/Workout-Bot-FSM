import React, { useState, useRef, useCallback } from 'react';
import { banUser } from '../../api/admin';
import { hapticNotification } from '../../utils/haptic';
import './BanUserModal.css';

interface Props {
    userId: string;
    userName: string;
    onClose: () => void;
    onSuccess: () => void;
}

const DAY_PRESETS = [
    { label: '2 дня (стандарт)', value: 2 },
    { label: '7 дней', value: 7 },
    { label: '14 дней', value: 14 },
    { label: '30 дней', value: 30 },
] as const;
const MISSED_OPTIONS = Array.from({ length: 11 }, (_, i) => i);

const BanUserModal: React.FC<Props> = ({ userId, userName, onClose, onSuccess }) => {
    const [days, setDays] = useState<number>(2);
    const [reason, setReason] = useState('');
    const [missed, setMissed] = useState(2);
    const [submitting, setSubmitting] = useState(false);
    const [reasonError, setReasonError] = useState(false);

    const sheetRef = useRef<HTMLDivElement>(null);
    const touchStartY = useRef(0);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const delta = e.changedTouches[0].clientY - touchStartY.current;
        if (delta > 80) onClose();
    }, [onClose]);

    const handleSubmit = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (reason.trim().length < 3) {
            setReasonError(true);
            return;
        }
        setReasonError(false);
        setSubmitting(true);
        try {
            await banUser(userId, { days, reason: reason.trim(), missed_workouts: missed });
            hapticNotification('warning');
            onSuccess();
            onClose();
        } catch {
            hapticNotification('error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="ban-modal-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={sheetRef}
                className="ban-modal-sheet"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="ban-modal-handle" />
                <div className="ban-modal-title">Забанить: {userName}</div>

                <div>
                    <div className="ban-modal-label">Срок</div>
                    <div className="ban-modal-presets">
                        {DAY_PRESETS.map(p => (
                            <button
                                key={p.value}
                                className={`ban-modal-preset-btn${days === p.value ? ' active' : ''}`}
                                onClick={(e) => { e.stopPropagation(); setDays(p.value); }}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <div className="ban-modal-label">Причина</div>
                    <textarea
                        className={`ban-modal-textarea${reasonError ? ' error' : ''}`}
                        placeholder="Минимум 3 символа..."
                        maxLength={500}
                        value={reason}
                        onChange={(e) => { setReason(e.target.value); setReasonError(false); }}
                        onClick={(e) => e.stopPropagation()}
                    />
                    <div className="ban-modal-hint">Игрок увидит причину на экране блокировки</div>
                </div>

                <div>
                    <div className="ban-modal-label">Пропущено тренировок</div>
                    <select
                        className="ban-modal-select"
                        value={missed}
                        onChange={(e) => setMissed(Number(e.target.value))}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {MISSED_OPTIONS.map(n => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                </div>

                <button
                    className="ban-modal-submit"
                    onClick={handleSubmit}
                    disabled={submitting}
                >
                    {submitting ? 'Бан...' : 'Применить бан'}
                </button>
                <button className="ban-modal-cancel" onClick={(e) => { e.stopPropagation(); onClose(); }}>
                    Отмена
                </button>
            </div>
        </div>
    );
};

export default BanUserModal;

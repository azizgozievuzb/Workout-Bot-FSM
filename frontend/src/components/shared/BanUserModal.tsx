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

const DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
const MISSED_OPTIONS = Array.from({ length: 11 }, (_, i) => i);

const BanUserModal: React.FC<Props> = ({ userId, userName, onClose, onSuccess }) => {
    const [days, setDays] = useState<number>(7);
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
                    <select
                        className="ban-modal-select"
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {DAY_OPTIONS.map(d => (
                            <option key={d} value={d}>{d} {d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}</option>
                        ))}
                    </select>
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

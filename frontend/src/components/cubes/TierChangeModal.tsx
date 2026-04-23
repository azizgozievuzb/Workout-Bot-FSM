import React, { useCallback, useEffect, useRef } from 'react';
import { hapticImpact } from '../../utils/haptic';

interface Props {
    onClose: () => void;
}

const TierChangeModal: React.FC<Props> = ({ onClose }) => {
    const touchStartY = useRef(0);

    useEffect(() => { hapticImpact('light'); }, []);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
    }, []);
    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const delta = e.changedTouches[0].clientY - touchStartY.current;
        if (delta > 80) onClose();
    }, [onClose]);

    return (
        <div
            className="cube-modal-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="cube-modal-sheet tier-change-modal-sheet"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="cube-modal-handle" />
                <div className="cube-modal-title">Смена тира</div>
                <div className="cube-modal-body">
                    Чтобы сменить тир игрока, отправьте команду <b>/upgrade</b> в боте Telegram.
                    Введите новый R-код нужного тира. Изменения применятся автоматически.
                </div>
                <div className="cube-modal-actions">
                    <button
                        type="button"
                        className="cube-modal-btn cube-modal-btn--primary"
                        onClick={onClose}
                    >
                        Понятно
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TierChangeModal;

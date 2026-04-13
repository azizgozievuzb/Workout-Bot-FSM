import React from 'react';
import { useAuthStore } from '../../stores/authStore';

declare const window: Window & { Telegram?: { WebApp?: { close: () => void } } };

const AccessRevokedScreen: React.FC = () => {
    const setAccessRevoked = useAuthStore((s) => s.setAccessRevoked);

    const handleClose = () => {
        window.Telegram?.WebApp?.close();
        // Fallback: reset state so user can retry
        setAccessRevoked(false);
    };

    return (
        <div className="access-revoked-screen">
            <div className="access-revoked-icon">🔒</div>
            <div className="access-revoked-title">Доступ истёк</div>
            <div className="access-revoked-text">
                Обратитесь к Ответственному за новым промокодом.
            </div>
            <button className="access-revoked-btn" onClick={handleClose}>
                Закрыть
            </button>
        </div>
    );
};

export default AccessRevokedScreen;

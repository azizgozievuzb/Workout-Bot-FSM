import React, { useEffect, useState } from 'react';
import type { BanInfo } from '../../stores/authStore';
import { useAuthStore } from '../../stores/authStore';
import './BanScreen.css';

interface Props {
    info: BanInfo;
}

function computeRemaining(until: string | null): string {
    if (!until) return '';
    const diff = new Date(until).getTime() - Date.now();
    if (diff <= 0) return '';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return `${days} дн.`;
    if (hours > 0) return `${hours} ч.`;
    return `${mins} мин.`;
}

const BanScreen: React.FC<Props> = ({ info }) => {
    const [remaining, setRemaining] = useState(() => computeRemaining(info.until));
    const setBanInfo = useAuthStore(s => s.setBanInfo);

    useEffect(() => {
        if (!info.until) return;
        const update = () => {
            const r = computeRemaining(info.until);
            if (!r) {
                setBanInfo(null);
                window.location.reload();
                return;
            }
            setRemaining(r);
        };
        update();
        const id = setInterval(update, 60_000);
        return () => clearInterval(id);
    }, [info.until, setBanInfo]);

    return (
        <div className="ban-screen">
            <div className="ban-icon">🚫</div>
            <h1 className="ban-title">Доступ временно ограничен</h1>

            {info.reason && (
                <div className="ban-reason-card">
                    <div className="ban-reason-label">Причина</div>
                    {info.reason}
                </div>
            )}

            {info.missed > 0 && (
                <div className="ban-remaining">
                    Пропущено тренировок:{' '}
                    <span className="ban-remaining-value">{info.missed}</span>
                </div>
            )}

            {remaining ? (
                <div className="ban-remaining">
                    Осталось: <span className="ban-remaining-value">{remaining}</span>
                </div>
            ) : null}

            <div className="ban-hint">
                Простите — это необходимо для соблюдения правил.
            </div>
        </div>
    );
};

export default BanScreen;

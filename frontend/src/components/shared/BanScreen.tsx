import React from 'react';
import type { BanInfo } from '../../stores/authStore';

interface Props {
    info: BanInfo;
}

const BanScreen: React.FC<Props> = ({ info }) => (
    <div style={{
        position: 'fixed', inset: 0, background: '#000',
        color: 'rgba(255,255,255,0.85)', display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '0 32px', fontSize: 18, zIndex: 99999,
        gap: 12,
    }}>
        <div>К сожалению, вы или ваш Ответственный были забанены.</div>
        {info.missed > 0 && (
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>
                {info.missed} {info.missed === 1 ? 'тренировка отменена' : 'тренировок отменены'}.
            </div>
        )}
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
            Простите, пожалуйста — это необходимо для соблюдения правил.
        </div>
    </div>
);

export default BanScreen;

import React, { useEffect, useState } from 'react';
import './MaintenanceScreen.css';

const GearIcon: React.FC = () => (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M32 20a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm0 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"
            fill="currentColor"
        />
        <path
            d="M54.9 28.5l-4.1-.7a19.1 19.1 0 0 0-1.6-3.8l2.4-3.4a2 2 0 0 0-.2-2.6l-5.4-5.4a2 2 0 0 0-2.6-.2l-3.4 2.4a19.1 19.1 0 0 0-3.8-1.6l-.7-4.1A2 2 0 0 0 33.5 8h-3a2 2 0 0 0-2 1.7l-.7 4.1a19.1 19.1 0 0 0-3.8 1.6l-3.4-2.4a2 2 0 0 0-2.6.2l-3.8 3.8a2 2 0 0 0-.2 2.6l2.4 3.4a19.1 19.1 0 0 0-1.6 3.8l-4.1.7A2 2 0 0 0 8 30.5v3a2 2 0 0 0 1.7 2l4.1.7a19.1 19.1 0 0 0 1.6 3.8l-2.4 3.4a2 2 0 0 0 .2 2.6l3.8 3.8a2 2 0 0 0 2.6.2l3.4-2.4a19.1 19.1 0 0 0 3.8 1.6l.7 4.1A2 2 0 0 0 29.5 56h5a2 2 0 0 0 2-1.7l.7-4.1a19.1 19.1 0 0 0 3.8-1.6l3.4 2.4a2 2 0 0 0 2.6-.2l3.8-3.8a2 2 0 0 0 .2-2.6l-2.4-3.4a19.1 19.1 0 0 0 1.6-3.8l4.1-.7A2 2 0 0 0 56 33.5v-3a2 2 0 0 0-1.1-2z"
            fill="currentColor"
            opacity="0.5"
        />
    </svg>
);

const fmt = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
};

const MaintenanceScreen: React.FC = () => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setElapsed(s => s + 1), 1000);
        return () => clearInterval(id);
    }, []);

    return (
        <div className="maintenance-screen">
            <div className="maintenance-icon">
                <GearIcon />
            </div>
            <h1 className="maintenance-title">Ведутся технические работы</h1>
            <p className="maintenance-text">
                Ваше время не расходуется — мы продлим его автоматически
            </p>
            <div className="maintenance-timer">Заморожено: {fmt(elapsed)}</div>
        </div>
    );
};

export default MaintenanceScreen;

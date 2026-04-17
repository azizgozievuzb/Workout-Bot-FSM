import React from 'react';

const MaintenanceScreen: React.FC = () => (
    <div style={{
        position: 'fixed', inset: 0, background: '#000',
        color: 'rgba(255,255,255,0.85)', display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '0 32px', fontSize: 18, zIndex: 99999,
        gap: 12,
    }}>
        <div>Ведутся технические работы.</div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
            Ваше время заморожено и не расходуется.
        </div>
    </div>
);

export default MaintenanceScreen;

import React from 'react';

const AccessRevokedScreen: React.FC = () => (
    <div style={{
        position: 'fixed', inset: 0, background: '#000',
        color: 'rgba(255,255,255,0.85)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '0 32px', fontSize: 18, zIndex: 99999,
    }}>
        К сожалению, вы не зарегистрированы.
    </div>
);

export default AccessRevokedScreen;

import React from 'react';

const BOT_USERNAME =
    (import.meta.env.VITE_BOT_USERNAME as string | undefined) || 'conectionWorkout_bot';

interface Props {
    message?: string | null;
}

const OnboardingBlockedScreen: React.FC<Props> = ({ message }) => {
    const text = message || 'Вернись в бот и пройди опрос — это займёт 30 секунд.';

    const handleOpenBot = () => {
        const tg = (window as any).Telegram?.WebApp;
        // Открываем чат с ботом и закрываем Mini App, чтобы пользователь сразу увидел диалог
        if (tg?.openTelegramLink) {
            tg.openTelegramLink(`https://t.me/${BOT_USERNAME}?start=settings`);
            setTimeout(() => tg.close?.(), 150);
            return;
        }
        if (tg?.close) {
            tg.close();
            return;
        }
        // Fallback (десктоп-браузер вне Telegram)
        window.location.href = `tg://resolve?domain=${BOT_USERNAME}`;
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: '#000',
                color: 'rgba(255,255,255,0.9)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '0 32px',
                gap: 20,
                zIndex: 99999,
            }}
        >
            <div style={{ fontSize: 40 }}>🎯</div>
            <div style={{ fontSize: 18, lineHeight: 1.45, maxWidth: 420 }}>{text}</div>
            <button
                onClick={handleOpenBot}
                style={{
                    marginTop: 8,
                    padding: '14px 26px',
                    background: 'rgba(255,255,255,0.14)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: 14,
                    color: '#fff',
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: 'pointer',
                }}
            >
                Пройти опрос
            </button>
        </div>
    );
};

export default OnboardingBlockedScreen;

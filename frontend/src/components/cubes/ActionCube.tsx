import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { getMyPlayerCode } from '../../api/promo';
import RoleTransition from '../shared/RoleTransition';
import '../../styles/cubes.css';

type ActiveView = 'player' | 'responsible';

const ActionCube: React.FC = () => {
    const { primary_role, has_player_access, has_responsible_access, is_admin } = useAuthStore();
    const user: DualRoleUser = {
        primary_role: primary_role || 'player',
        has_player_access,
        has_responsible_access,
        is_admin,
    };

    const [view, setView] = useState<ActiveView>(canPlay(user) ? 'player' : 'responsible');
    const dual = isDualRole(user);

    const toggleView = () => setView(v => v === 'player' ? 'responsible' : 'player');

    return (
        <div className="cube-module">
            <RoleTransition
                view={view}
                dual={dual}
                onToggle={toggleView}
                lockedMessage={view === 'player'
                    ? 'Введите промокод чтобы разблокировать'
                    : 'Вам нужна пригласительная ссылка'}
            >
                {view === 'player' ? (
                    canPlay(user) ? <PlayerView /> : <LockedPlayer />
                ) : (
                    canMonitor(user) ? <ResponsibleView /> : <LockedResponsible />
                )}
            </RoleTransition>
        </div>
    );
};

/* ---------- PLAYER ---------- */

const PlayerView: React.FC = () => (
    <>
        <button className="cube-btn-primary" onClick={(e) => e.stopPropagation()}>
            Приступим
        </button>

        <div className="cube-card">
            <div className="cube-stat">
                <span>Стрик</span>
                <span className="cube-stat-value">5 дней</span>
            </div>
        </div>

        <div className="cube-card">
            <div className="cube-stat">
                <span>Буст X2</span>
                <span className="cube-stat-value" style={{ color: '#CCFF00' }}>активен 2ч</span>
            </div>
        </div>

        <div className="cube-funfact">
            Знаешь ли ты, что регулярные тренировки улучшают качество сна на 65%? Твоё тело скажет спасибо!
        </div>

        {/* Rest day — mock: show for female */}
        <button className="cube-rest-btn" onClick={(e) => e.stopPropagation()}>
            День отдыха (осталось 3/3)
        </button>
    </>
);

/* ---------- RESPONSIBLE ---------- */

const MOCK_PLAYERS = [
    { id: 1, name: 'Алексей', initials: 'А', streak: 12, trained: true },
    { id: 2, name: 'Марина', initials: 'М', streak: 3, trained: false },
];

interface PlayerCodeData {
    code: string | null;
    deep_link: string | null;
    is_used: boolean;
}

const ResponsibleView: React.FC = () => {
    const [playerCodeData, setPlayerCodeData] = useState<PlayerCodeData | null>(null);
    const [toast, setToast] = useState('');

    useEffect(() => {
        getMyPlayerCode()
            .then((data) => setPlayerCodeData(data))
            .catch(() => {});
    }, []);

    const copyCode = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!playerCodeData?.code) return;
        navigator.clipboard.writeText(playerCodeData.code);
        setToast('Скопировано!');
        setTimeout(() => setToast(''), 2000);
    }, [playerCodeData]);

    const copyLink = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!playerCodeData?.deep_link) return;
        navigator.clipboard.writeText(playerCodeData.deep_link);
        setToast('Скопировано!');
        setTimeout(() => setToast(''), 2000);
    }, [playerCodeData]);

    return (
        <>
            {playerCodeData && playerCodeData.code && !playerCodeData.is_used && (
                <div className="promo-invite-block">
                    <div className="promo-invite-label">Пригласите игрока</div>
                    <div className="promo-invite-code">{playerCodeData.code}</div>
                    <div className="promo-invite-actions">
                        <button className="cube-btn-sm" onClick={copyCode}>
                            📋 Скопировать код
                        </button>
                        <button className="cube-btn-sm" onClick={copyLink}>
                            🔗 Скопировать ссылку
                        </button>
                    </div>
                    {toast && <div className="promo-invite-toast">{toast}</div>}
                </div>
            )}

            <div className="cube-section-title">Ваши игроки</div>

            <div className="cube-card">
                {MOCK_PLAYERS.map(p => (
                    <div className="cube-player-row" key={p.id}>
                        <div className="cube-avatar">{p.initials}</div>
                        <div className="cube-player-info">
                            <div className="cube-player-name">{p.name}</div>
                            <div className="cube-player-meta">
                                Стрик: {p.streak} · {p.trained ? 'Тренировался' : 'Не тренировался'}
                            </div>
                        </div>
                        <div className="cube-player-actions">
                            <button className="cube-btn-sm" onClick={(e) => e.stopPropagation()}>
                                Пинг
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <button className="cube-btn-primary" onClick={(e) => e.stopPropagation()}>
                Буст X2
            </button>
        </>
    );
};

/* ---------- LOCKED SCREENS ---------- */

const LockedPlayer: React.FC = () => (
    <div className="cube-locked">
        <div className="cube-locked-icon">P</div>
        <div className="cube-locked-title">Игрок</div>
        <div className="cube-locked-text">
            Вам нужна пригласительная ссылка от Ответственного, чтобы начать тренировки.
        </div>
    </div>
);

const LockedResponsible: React.FC = () => (
    <div className="cube-locked">
        <div className="cube-locked-icon">R</div>
        <div className="cube-locked-title">Ответственный</div>
        <div className="cube-locked-text">
            Введите промокод, чтобы стать Ответственным и мотивировать других.
        </div>
    </div>
);

export default ActionCube;

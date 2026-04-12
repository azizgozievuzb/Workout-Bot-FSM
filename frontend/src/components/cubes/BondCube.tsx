import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import RoleTransition from '../shared/RoleTransition';
import '../../styles/cubes.css';

type ActiveView = 'player' | 'responsible';

const PLAYER_FEED = [
    { id: 1, icon: '⚡', text: 'Ответственный активировал буст X2', time: '2 часа назад' },
    { id: 2, icon: '🔔', text: 'Пинг от Ответственного', time: '5 часов назад' },
    { id: 3, icon: '🏆', text: 'Новое достижение: 7 дней стрик', time: 'Вчера' },
    { id: 4, icon: '🎁', text: 'Получен подарок: аватар "Космонавт"', time: '2 дня назад' },
];

const RESPONSIBLE_FEED = [
    { id: 1, icon: '💪', text: 'Алексей завершил тренировку +45', time: '1 час назад' },
    { id: 2, icon: '💔', text: 'Марина потеряла стрик', time: '3 часа назад' },
    { id: 3, icon: '🛒', text: 'Дима купил аватар', time: 'Вчера' },
];

const BADGES = [
    { id: 1, icon: '🔥' },
    { id: 2, icon: '⭐' },
    { id: 3, icon: '🎯' },
];

const BondCube: React.FC = () => {
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
                    canPlay(user) ? <PlayerBond /> : <LockedPlayer />
                ) : (
                    canMonitor(user) ? <ResponsibleBond /> : <LockedResponsible />
                )}
            </RoleTransition>
        </div>
    );
};

/* ---------- PLAYER BOND ---------- */

const PlayerBond: React.FC = () => (
    <>
        <div className="cube-section-title">Лента</div>

        {PLAYER_FEED.map(item => (
            <div className="cube-feed-card" key={item.id}>
                <div className="cube-feed-icon">{item.icon}</div>
                <div>
                    <div className="cube-feed-text">{item.text}</div>
                    <div className="cube-feed-time">{item.time}</div>
                </div>
            </div>
        ))}

        <div className="cube-section-title">Достижения</div>

        <div className="cube-badges">
            {BADGES.map(b => (
                <div className="cube-badge" key={b.id}>{b.icon}</div>
            ))}
        </div>

        <button className="cube-btn-secondary" onClick={(e) => e.stopPropagation()}>
            Профиль и настройки
        </button>
    </>
);

/* ---------- RESPONSIBLE BOND ---------- */

const ResponsibleBond: React.FC = () => (
    <>
        <div className="cube-section-title">Лента игроков</div>

        {RESPONSIBLE_FEED.map(item => (
            <div className="cube-feed-card" key={item.id}>
                <div className="cube-feed-icon">{item.icon}</div>
                <div>
                    <div className="cube-feed-text">{item.text}</div>
                    <div className="cube-feed-time">{item.time}</div>
                </div>
            </div>
        ))}

        <button className="cube-btn-primary" onClick={(e) => e.stopPropagation()}>
            Инвайт-ссылка
        </button>

        <button className="cube-btn-secondary" onClick={(e) => e.stopPropagation()}>
            Настройки уведомлений
        </button>

        <button className="cube-btn-secondary" onClick={(e) => e.stopPropagation()}>
            Подписка и биллинг
        </button>
    </>
);

/* ---------- LOCKED ---------- */

const LockedPlayer: React.FC = () => (
    <div className="cube-locked">
        <div className="cube-locked-icon">P</div>
        <div className="cube-locked-title">Связь Игрока</div>
        <div className="cube-locked-text">
            Вам нужна пригласительная ссылка, чтобы видеть ленту активности.
        </div>
    </div>
);

const LockedResponsible: React.FC = () => (
    <div className="cube-locked">
        <div className="cube-locked-icon">R</div>
        <div className="cube-locked-title">Связь Ответственного</div>
        <div className="cube-locked-text">
            Введите промокод, чтобы следить за активностью ваших игроков.
        </div>
    </div>
);

export default BondCube;

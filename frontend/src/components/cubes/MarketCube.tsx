import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import RoleTransition from '../shared/RoleTransition';
import '../../styles/cubes.css';

type ActiveView = 'player' | 'responsible';

const SHOP_ITEMS = [
    { id: 'skip',     name: 'Скип',     icon: '⏭',  price: 50  },
    { id: 'avatar',   name: 'Аватар',   icon: '🎭', price: 100 },
    { id: 'lootbox',  name: 'Лутбокс',  icon: '📦', price: 75  },
    { id: 'troll',    name: 'Тролл',    icon: '👹', price: 200 },
    { id: 'hardcore', name: 'Хардкор',  icon: '🔥', price: 300 },
];

const MOCK_PLAYERS_MARKET = [
    { id: 1, name: 'Алексей', balance: 120 },
    { id: 2, name: 'Марина',  balance: 85  },
];

const MarketCube: React.FC = () => {
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
                    canPlay(user) ? <PlayerShop /> : <LockedPlayer />
                ) : (
                    canMonitor(user) ? <ResponsibleShop /> : <LockedResponsible />
                )}
            </RoleTransition>
        </div>
    );
};

/* ---------- PLAYER SHOP ---------- */

const PlayerShop: React.FC = () => (
    <>
        <div className="cube-balance">150</div>

        <div className="cube-shop-grid">
            {SHOP_ITEMS.map(item => (
                <div className="cube-shop-item" key={item.id}>
                    <div className="cube-shop-icon">{item.icon}</div>
                    <div className="cube-shop-name">{item.name}</div>
                    <div className="cube-shop-price">{item.price}</div>
                    <button className="cube-btn-sm" onClick={(e) => e.stopPropagation()}>
                        Купить
                    </button>
                </div>
            ))}
        </div>
    </>
);

/* ---------- RESPONSIBLE SHOP ---------- */

const ResponsibleShop: React.FC = () => {
    const [activeTab, setActiveTab] = useState(0);
    const player = MOCK_PLAYERS_MARKET[activeTab];

    return (
        <>
            <div className="cube-tabs">
                {MOCK_PLAYERS_MARKET.map((p, i) => (
                    <button
                        key={p.id}
                        className={`cube-tab ${i === activeTab ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setActiveTab(i); }}
                    >
                        {p.name}
                    </button>
                ))}
            </div>

            <div className="cube-balance">{player.balance}</div>

            <button className="cube-btn-secondary" onClick={(e) => e.stopPropagation()}>
                Пополнить
            </button>

            <div className="cube-shop-grid">
                {SHOP_ITEMS.map(item => (
                    <div className="cube-shop-item" key={item.id}>
                        <div className="cube-shop-icon">{item.icon}</div>
                        <div className="cube-shop-name">{item.name}</div>
                        <div className="cube-shop-price">{item.price}</div>
                        <button className="cube-btn-sm" onClick={(e) => e.stopPropagation()}>
                            Купить
                        </button>
                    </div>
                ))}
            </div>
        </>
    );
};

/* ---------- LOCKED ---------- */

const LockedPlayer: React.FC = () => (
    <div className="cube-locked">
        <div className="cube-locked-icon">P</div>
        <div className="cube-locked-title">Магазин Игрока</div>
        <div className="cube-locked-text">
            Вам нужна пригласительная ссылка, чтобы получить доступ к магазину.
        </div>
    </div>
);

const LockedResponsible: React.FC = () => (
    <div className="cube-locked">
        <div className="cube-locked-icon">R</div>
        <div className="cube-locked-title">Магазин Ответственного</div>
        <div className="cube-locked-text">
            Введите промокод, чтобы пополнять баланс своих игроков.
        </div>
    </div>
);

export default MarketCube;

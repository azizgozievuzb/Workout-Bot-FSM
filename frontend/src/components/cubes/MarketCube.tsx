import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { getShopItems, purchaseItem } from '../../api/shop';
import type { ShopItem } from '../../api/shop';
import { getMyStats } from '../../api/stats';
import { getPartnerStats } from '../../api/stats';
import type { PartnerStats } from '../../api/stats';
import RoleTransition from '../shared/RoleTransition';
import '../../styles/cubes.css';

type ActiveView = 'player' | 'responsible';

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

const PlayerShop: React.FC = () => {
    const [items, setItems] = useState<ShopItem[]>([]);
    const [balance, setBalance] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState('');

    useEffect(() => {
        Promise.all([getShopItems(), getMyStats()])
            .then(([shopItems, stats]) => {
                setItems(shopItems);
                setBalance(stats.star_balance);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const handleBuy = useCallback(async (e: React.MouseEvent, itemId: string) => {
        e.stopPropagation();
        try {
            const res = await purchaseItem(itemId);
            setBalance(res.new_balance);
            setToast(res.message);
        } catch (err: any) {
            setToast(err?.response?.data?.detail || 'Ошибка покупки');
        }
        setTimeout(() => setToast(''), 3000);
    }, []);

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;

    return (
        <>
            <div className="cube-balance">{balance}</div>

            {toast && <div className="admin-toast">{toast}</div>}

            <div className="cube-shop-grid">
                {items.map(item => (
                    <div className="cube-shop-item" key={item.id}>
                        <div className="cube-shop-icon">{item.emoji}</div>
                        <div className="cube-shop-name">{item.name}</div>
                        <div className="cube-shop-price">{item.price_stars}</div>
                        <button
                            className="cube-btn-sm"
                            onClick={(e) => handleBuy(e, item.id)}
                            disabled={balance < item.price_stars}
                        >
                            {balance < item.price_stars ? 'Мало ⭐' : 'Купить'}
                        </button>
                    </div>
                ))}
            </div>
        </>
    );
};

/* ---------- RESPONSIBLE SHOP ---------- */

const ResponsibleShop: React.FC = () => {
    const [players, setPlayers] = useState<PartnerStats[]>([]);
    const [items, setItems] = useState<ShopItem[]>([]);
    const [activeTab, setActiveTab] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([getPartnerStats(), getShopItems()])
            .then(([p, s]) => { setPlayers(p); setItems(s); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;
    if (players.length === 0) return (
        <div className="cube-locked">
            <div className="cube-locked-text">Нет привязанных игроков</div>
        </div>
    );

    const player = players[activeTab] || players[0];

    return (
        <>
            <div className="cube-tabs">
                {players.map((p, i) => (
                    <button
                        key={p.player_id}
                        className={`cube-tab ${i === activeTab ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setActiveTab(i); }}
                    >
                        {p.first_name}
                    </button>
                ))}
            </div>

            <div className="cube-balance">{player.star_balance}</div>

            <button className="cube-btn-secondary" onClick={(e) => e.stopPropagation()}>
                Пополнить
            </button>

            <div className="cube-shop-grid">
                {items.map(item => (
                    <div className="cube-shop-item" key={item.id}>
                        <div className="cube-shop-icon">{item.emoji}</div>
                        <div className="cube-shop-name">{item.name}</div>
                        <div className="cube-shop-price">{item.price_stars}</div>
                        <button className="cube-btn-sm" onClick={(e) => e.stopPropagation()}>
                            Подарить
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

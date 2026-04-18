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
    const { primary_role, has_player_access, has_responsible_access, is_admin, activeRoleView, setActiveRoleView } = useAuthStore();
    const user: DualRoleUser = {
        primary_role: primary_role || 'player',
        has_player_access,
        has_responsible_access,
        is_admin,
    };

    const defaultView: ActiveView = canPlay(user) ? 'player' : 'responsible';
    const persistedAllowed = activeRoleView
        && (activeRoleView === 'player' ? canPlay(user) : canMonitor(user));
    const view: ActiveView = persistedAllowed ? (activeRoleView as ActiveView) : defaultView;
    const dual = isDualRole(user);

    const toggleView = () => setActiveRoleView(view === 'player' ? 'responsible' : 'player');

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
    const { accessTier } = useAuthStore();
    const [items, setItems] = useState<ShopItem[]>([]);
    const [balance, setBalance] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState('');

    useEffect(() => {
        let done = 0;
        const check = () => { if (++done >= 2) setLoading(false); };
        getShopItems()
            .then(setItems)
            .catch((err) => {
                console.error('[MarketCube] getShopItems FAILED:', err?.response?.status, err?.response?.data, err?.message);
            })
            .finally(check);
        getMyStats()
            .then(s => setBalance(s.star_balance))
            .catch((err) => {
                console.error('[MarketCube] getMyStats FAILED:', err?.response?.status, err?.response?.data, err?.message);
            })
            .finally(check);
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
            <div className="market-payment-hint">
                <div className="market-payment-hint-row">
                    <span className="payment-method-icon">⭐</span>
                    <div className="market-payment-hint-text">
                        <div className="market-payment-hint-title">Оплата Stars</div>
                        <div className="market-payment-hint-sub">Скоро — покупай лоты за Telegram Stars</div>
                    </div>
                </div>
                <div className="market-payment-hint-row">
                    <span className="payment-method-icon">💎</span>
                    <div className="market-payment-hint-text">
                        <div className="market-payment-hint-title">Crypto (TON)</div>
                        <div className="market-payment-hint-sub">Скоро — оплата через TON Connect</div>
                    </div>
                </div>
            </div>

            <div className="cube-balance">{balance}</div>

            {toast && <div className="admin-toast">{toast}</div>}

            <div className="cube-shop-grid">
                {items.slice(0, 5).map(item => (
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
                {/* 6th slot: unlocked for elite tier */}
                {accessTier === 'elite' && items[5] ? (
                    <div className="cube-shop-item" key={items[5].id}>
                        <div className="cube-shop-icon">{items[5].emoji}</div>
                        <div className="cube-shop-name">{items[5].name}</div>
                        <div className="cube-shop-price">{items[5].price_stars}</div>
                        <button
                            className="cube-btn-sm"
                            onClick={(e) => handleBuy(e, items[5].id)}
                            disabled={balance < items[5].price_stars}
                        >
                            {balance < items[5].price_stars ? 'Мало ⭐' : 'Купить'}
                        </button>
                    </div>
                ) : (
                    <div className="cube-shop-item cube-shop-item-locked">
                        <div className="cube-shop-icon">🔒</div>
                        <div className="cube-shop-name">6-й слот</div>
                        <div className="cube-shop-price" style={{ fontSize: '10px' }}>Elite</div>
                        <button className="cube-btn-sm" disabled>ELT</button>
                    </div>
                )}
            </div>
        </>
    );
};

/* ---------- RESPONSIBLE SHOP ---------- */

const ResponsibleShop: React.FC = () => {
    const { accessTier } = useAuthStore();
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
                {items.slice(0, 5).map(item => (
                    <div className="cube-shop-item" key={item.id}>
                        <div className="cube-shop-icon">{item.emoji}</div>
                        <div className="cube-shop-name">{item.name}</div>
                        <div className="cube-shop-price">{item.price_stars}</div>
                        <button className="cube-btn-sm" onClick={(e) => e.stopPropagation()}>
                            Подарить
                        </button>
                    </div>
                ))}
                {/* 6th slot: unlocked for elite Responsible (their players inherit ELT too) */}
                {accessTier === 'elite' && items[5] ? (
                    <div className="cube-shop-item" key={items[5].id}>
                        <div className="cube-shop-icon">{items[5].emoji}</div>
                        <div className="cube-shop-name">{items[5].name}</div>
                        <div className="cube-shop-price">{items[5].price_stars}</div>
                        <button className="cube-btn-sm" onClick={(e) => e.stopPropagation()}>
                            Подарить
                        </button>
                    </div>
                ) : (
                    <div className="cube-shop-item cube-shop-item-locked">
                        <div className="cube-shop-icon">🔒</div>
                        <div className="cube-shop-name">6-й слот</div>
                        <div className="cube-shop-price" style={{ fontSize: '10px' }}>Elite</div>
                        <button className="cube-btn-sm" disabled>ELT</button>
                    </div>
                )}
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

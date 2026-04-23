import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { getShopItems, purchaseItem } from '../../api/shop';
import type { ShopItem } from '../../api/shop';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import GiftFreezeModal from './GiftFreezeModal';
import { hapticNotification } from '../../utils/haptic';
import RoleTransition from '../shared/RoleTransition';
import '../../styles/cubes.css';

type ActiveView = 'player' | 'responsible';

/* ============================================================
   ROOT
   ============================================================ */
const MarketCube: React.FC = () => {
    const { primary_role, has_player_access, has_responsible_access, is_admin, activeRoleView, setActiveRoleView } = useAuthStore();
    const user: DualRoleUser = {
        primary_role: primary_role || 'player',
        has_player_access,
        has_responsible_access,
        is_admin,
    };

    const defaultView: ActiveView = canPlay(user) ? 'player' : 'responsible';
    const persistedAllowed = activeRoleView &&
        (activeRoleView === 'player' ? canPlay(user) : canMonitor(user));
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

/* ============================================================
   SHARED — ShopItemCard
   ============================================================ */
interface CardProps {
    item: ShopItem;
    buyingId: string | null;
    onBuy?: (item: ShopItem) => void;
    onGift?: (item: ShopItem) => void;
    dimmed?: boolean;
}

const ShopItemCard: React.FC<CardProps> = ({ item, buyingId, onBuy, onGift, dimmed }) => {
    const isFreeze = item.item_type === 'streak_freeze';
    const isBuying = buyingId === item.id;
    const showQty = item.freeze_count > 1;

    return (
        <div className={
            'shop-item-card' +
            (isFreeze ? ' shop-item-card--freeze' : '') +
            (dimmed ? ' shop-item-card--dimmed' : '')
        }>
            <div className="shop-item-name">
                {isFreeze ? '❄️ ' : ''}{item.name}
            </div>
            {item.description && (
                <div className="shop-item-desc">{item.description}</div>
            )}
            <div className="shop-item-price-row">
                <span className="shop-item-price">⭐ {item.price_stars}</span>
                {showQty && <span className="shop-item-qty">×{item.freeze_count}</span>}
            </div>
            {onBuy && (
                <button
                    className="cube-btn-sm"
                    onClick={(e) => { e.stopPropagation(); onBuy(item); }}
                    disabled={isBuying}
                >
                    {isBuying ? '…' : 'Купить'}
                </button>
            )}
            {onGift && (
                <button
                    className="cube-btn-sm"
                    onClick={(e) => { e.stopPropagation(); onGift(item); }}
                >
                    Подарить ❄️
                </button>
            )}
        </div>
    );
};

/* ============================================================
   SHARED — Skeleton (3 cards)
   ============================================================ */
const ShopSkeleton: React.FC = () => (
    <div className="shop-item-grid">
        {[0, 1, 2].map(i => <div key={i} className="shop-skeleton-card" />)}
    </div>
);

/* ============================================================
   PLAYER SHOP
   ============================================================ */
const PlayerShop: React.FC = () => {
    const { streakFreezeBalance, setStreakFreezeBalance } = useAuthStore();
    const [items, setItems] = useState<ShopItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [toast, setToast] = useState('');
    const [buyingId, setBuyingId] = useState<string | null>(null);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    }, []);

    const load = useCallback(() => {
        setLoading(true);
        setFetchError(false);
        getShopItems()
            .then(setItems)
            .catch(() => setFetchError(true))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const showFreezeChip = streakFreezeBalance > 0 ||
        (!loading && items.some(i => i.item_type === 'streak_freeze'));

    const handleBuy = async (item: ShopItem) => {
        if (buyingId) return;
        setBuyingId(item.id);
        try {
            await purchaseItem(item.id);
            hapticNotification('success');
            showToast('Куплено!');
            if (item.item_type === 'streak_freeze') {
                setStreakFreezeBalance(streakFreezeBalance + item.freeze_count);
                setItems(prev => prev.filter(i => i.id !== item.id));
            }
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            const code = typeof detail === 'object' ? detail?.code : '';
            if (code === 'NOT_YOUR_ITEM') {
                showToast('Недоступно');
            } else if (typeof detail === 'string' && detail.includes('Недостаточно')) {
                showToast('Недостаточно звёзд');
            } else {
                showToast('Ошибка покупки');
            }
            hapticNotification('error');
        } finally {
            setBuyingId(null);
        }
    };

    return (
        <>
            {showFreezeChip && (
                <div className="freeze-balance-chip">❄️ Заморозок: {streakFreezeBalance}</div>
            )}

            {/* Coming Soon stubs — session 16, keep as-is */}
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

            {toast && <div className="admin-toast">{toast}</div>}

            {loading ? (
                <ShopSkeleton />
            ) : fetchError ? (
                <div className="cube-locked">
                    <div className="cube-locked-text">Не удалось загрузить</div>
                    <button
                        className="cube-btn-sm"
                        onClick={(e) => { e.stopPropagation(); load(); }}
                    >
                        Повторить
                    </button>
                </div>
            ) : items.length === 0 ? (
                <div className="cube-locked">
                    <div className="cube-locked-text">Магазин пуст</div>
                </div>
            ) : (
                <div className="shop-item-grid">
                    {items.map(item => (
                        <ShopItemCard
                            key={item.id}
                            item={item}
                            buyingId={buyingId}
                            onBuy={handleBuy}
                        />
                    ))}
                </div>
            )}
        </>
    );
};

/* ============================================================
   RESPONSIBLE SHOP
   ============================================================ */
const ResponsibleShop: React.FC = () => {
    const [players, setPlayers] = useState<MyPlayer[]>([]);
    const [selectedPlayer, setSelectedPlayer] = useState<MyPlayer | null>(null);
    const [items, setItems] = useState<ShopItem[]>([]);
    const [loadingPlayers, setLoadingPlayers] = useState(true);
    const [loadingItems, setLoadingItems] = useState(false);
    const [toast, setToast] = useState('');
    const [giftTarget, setGiftTarget] = useState<ShopItem | null>(null);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    }, []);

    useEffect(() => {
        getMyPlayers()
            .then(ps => {
                const active = ps.filter(p => !p.is_expired && !p.is_deactivated);
                setPlayers(active);
                if (active.length > 0) setSelectedPlayer(active[0]);
            })
            .catch(() => {})
            .finally(() => setLoadingPlayers(false));
    }, []);

    useEffect(() => {
        if (!selectedPlayer) { setItems([]); return; }
        setLoadingItems(true);
        getShopItems(selectedPlayer.id)
            .then(setItems)
            .catch(() => setItems([]))
            .finally(() => setLoadingItems(false));
    }, [selectedPlayer]);

    if (loadingPlayers) return (
        <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>
    );

    if (players.length === 0) return (
        <div className="cube-locked">
            <div className="cube-locked-text">Нет активных игроков</div>
        </div>
    );

    return (
        <>
            {toast && <div className="admin-toast">{toast}</div>}

            <div className="market-player-selector">
                {players.map(p => (
                    <button
                        key={p.id}
                        className={`market-player-chip${selectedPlayer?.id === p.id ? ' active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setSelectedPlayer(p); }}
                    >
                        {p.first_name || 'Игрок'}
                    </button>
                ))}
            </div>

            {loadingItems ? (
                <ShopSkeleton />
            ) : items.length === 0 ? (
                <div className="cube-locked">
                    <div className="cube-locked-text">У игрока нет лотов в магазине</div>
                </div>
            ) : (
                <div className="shop-item-grid">
                    {items.map(item => (
                        <ShopItemCard
                            key={item.id}
                            item={item}
                            buyingId={null}
                            onGift={item.item_type === 'streak_freeze'
                                ? (i) => setGiftTarget(i)
                                : undefined}
                            dimmed={item.item_type !== 'streak_freeze'}
                        />
                    ))}
                </div>
            )}

            {giftTarget && selectedPlayer && (
                <GiftFreezeModal
                    targetUserId={selectedPlayer.id}
                    playerName={selectedPlayer.first_name}
                    onClose={() => setGiftTarget(null)}
                    onSuccess={(msg) => { showToast(msg); setGiftTarget(null); }}
                />
            )}
        </>
    );
};

/* ============================================================
   LOCKED SCREENS
   ============================================================ */
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

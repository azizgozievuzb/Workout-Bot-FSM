import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { buyFreeze, getPlayerShop, getShopItems, purchaseItem } from '../../api/shop';
import type { PlayerShopState, ShopItem } from '../../api/shop';
import { getSchedule, unlockLight, lockLight, type ScheduleState } from '../../api/schedule';
import DisclaimerTest, { UNLOCK_QUESTIONS, LOCK_QUESTIONS } from '../schedule/DisclaimerTest';
import CardPhotoFlow from './CardPhotoFlow';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import GiftFreezeModal from './GiftFreezeModal';
import { hapticNotification } from '../../utils/haptic';
import RoleTransition from '../shared/RoleTransition';
import '../../styles/cubes.css';
import '../schedule/schedule.css';

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
                <span className="shop-item-price">{item.price_drops} XP</span>
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
/*
 * 8c: витрина игрока — шапка с балансом 💧 + ровно 4 карточки (§8.8):
 * Unlock light / Lock light (дисклеймер-тесты), Заморозка (кап 3), Фото-карточка.
 * Ниже — лоты от наставника (legacy shop_items; полный редизайн полки — 8d).
 * Заглушки «Оплата Stars / TON скоро» убраны из витрины игрока.
 */
const PlayerShop: React.FC = () => {
    const { streakFreezeBalance, setStreakFreezeBalance } = useAuthStore();
    const [shop, setShop] = useState<PlayerShopState | null>(null);
    const [sched, setSched] = useState<ScheduleState | null>(null);
    const [items, setItems] = useState<ShopItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [toast, setToast] = useState('');
    const [busy, setBusy] = useState(false);
    const [buyingId, setBuyingId] = useState<string | null>(null);
    const [test, setTest] = useState<'unlock' | 'lock' | null>(null);
    const [photoFlow, setPhotoFlow] = useState(false);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    }, []);

    const load = useCallback(() => {
        setLoading(true);
        setFetchError(false);
        Promise.all([getPlayerShop(), getSchedule(), getShopItems().catch(() => [] as ShopItem[])])
            .then(([s, sc, lots]) => {
                setShop(s);
                setSched(sc);
                // Легаси-лоты показываем только адресные от наставника (8d переделает полку).
                setItems(lots.filter(i => i.responsible_id));
            })
            .catch(() => setFetchError(true))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const refreshShop = useCallback(() => {
        getPlayerShop().then(setShop).catch(() => {});
    }, []);

    const failToast = useCallback((e: any, fallback: string) => {
        hapticNotification('error');
        const detail = e?.response?.data?.detail;
        const code = typeof detail === 'object' ? detail?.code : '';
        if (code === 'INSUFFICIENT_DROPS') {
            showToast(`Недостаточно капель (${detail?.balance}/${detail?.price})`);
        } else if (code === 'FREEZE_CAP') {
            showToast('Запас купленных заморозок полон (3/3)');
        } else {
            showToast(fallback);
        }
    }, [showToast]);

    const doUnlock = useCallback(async () => {
        setTest(null); setBusy(true);
        try {
            const res = await unlockLight();
            setSched(res);
            hapticNotification('success');
            showToast(res.light_active_from
                ? `Light с понедельника ${res.light_active_from.slice(8, 10)}.${res.light_active_from.slice(5, 7)}`
                : 'Light-режим открыт');
            refreshShop();
        } catch (e: any) { failToast(e, 'Не удалось открыть light'); }
        finally { setBusy(false); }
    }, [showToast, failToast, refreshShop]);

    const doLock = useCallback(async () => {
        setTest(null); setBusy(true);
        try {
            const res = await lockLight();
            setSched(res);
            hapticNotification('success');
            showToast('Light закроется со следующего понедельника');
            refreshShop();
        } catch (e: any) { failToast(e, 'Не удалось закрыть light'); }
        finally { setBusy(false); }
    }, [showToast, failToast, refreshShop]);

    const doBuyFreeze = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await buyFreeze();
            hapticNotification('success');
            showToast('❄️ Заморозка куплена');
            setShop(prev => prev ? { ...prev, drops_balance: res.drops_balance, paid_freezes: res.paid_freezes } : prev);
        } catch (e: any) { failToast(e, 'Не удалось купить заморозку'); }
        finally { setBusy(false); }
    }, [busy, showToast, failToast]);

    // Покупка легаси-лота наставника (unchanged механика).
    const handleBuyLot = async (item: ShopItem) => {
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
            refreshShop();
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            const code = typeof detail === 'object' ? detail?.code : '';
            if (code === 'NOT_YOUR_ITEM') showToast('Недоступно');
            else if (typeof detail === 'string' && detail.includes('Недостаточно')) showToast('Недостаточно капель');
            else showToast('Ошибка покупки');
            hapticNotification('error');
        } finally {
            setBuyingId(null);
        }
    };

    if (loading) return <ShopSkeleton />;
    if (fetchError || !shop) return (
        <div className="cube-locked">
            <div className="cube-locked-text">Не удалось загрузить</div>
            <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); load(); }}>
                Повторить
            </button>
        </div>
    );

    const prices = shop.prices;
    const unlockPrice = prices['light_unlock'] ?? sched?.light_unlock_price ?? 300;
    const lockPrice = prices['light_lock'] ?? sched?.light_lock_price ?? 500;
    const freezePrice = prices['freeze'] ?? 50;
    // 8c.1: актуальные для юзера цены (прогрессия AI-смен/рероллов, raw — фикс)
    const photoAiPrice = shop.photo_card_ai_price ?? prices['photo_card'] ?? 200;
    const photoRawPrice = shop.photo_card_raw_price ?? prices['photo_card'] ?? 200;
    const rerollPrice = shop.photo_reroll_price ?? prices['photo_reroll'] ?? 60;
    const lightUnlocked = sched?.light_unlocked ?? false;
    const freezeCapReached = shop.paid_freezes >= shop.paid_freezes_cap;

    return (
        <>
            {/* Шапка: баланс капель — постоянно видим (UX-долг №5) */}
            <div className="market-balance-header">
                <span className="market-balance-value">💧 {shop.drops_balance}</span>
                <span className="market-balance-label">твои капли</span>
            </div>

            {toast && <div className="admin-toast">{toast}</div>}

            <div className="shop-item-grid">
                {/* 1-2. Unlock / Lock light */}
                {!lightUnlocked ? (
                    <div className="shop-item-card">
                        <div className="shop-item-name">✨ Открыть light-режим</div>
                        <div className="shop-item-desc">Лёгкая зарядка каждый день. Стрик станет ежедневным.</div>
                        <div className="shop-item-price-row">
                            <span className="shop-item-price">{unlockPrice} 💧</span>
                        </div>
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); setTest('unlock'); }}>
                            Купить
                        </button>
                    </div>
                ) : (
                    <div className="shop-item-card">
                        <div className="shop-item-name">Закрыть light-режим</div>
                        <div className="shop-item-desc">Main-only со следующего понедельника.</div>
                        <div className="shop-item-price-row">
                            <span className="shop-item-price">{lockPrice} 💧</span>
                        </div>
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); setTest('lock'); }}>
                            Купить
                        </button>
                    </div>
                )}

                {/* 3. Заморозка */}
                <div className="shop-item-card shop-item-card--freeze">
                    <div className="shop-item-name">❄️ Заморозка</div>
                    <div className="shop-item-desc">
                        В запасе: бесплатных {shop.free_freezes_left}, купленных {shop.paid_freezes}/{shop.paid_freezes_cap}
                    </div>
                    <div className="shop-item-price-row">
                        <span className="shop-item-price">{freezePrice} 💧</span>
                    </div>
                    <button className="cube-btn-sm" disabled={busy || freezeCapReached}
                        onClick={(e) => { e.stopPropagation(); doBuyFreeze(); }}>
                        {freezeCapReached ? 'Запас полон' : busy ? '…' : 'Купить'}
                    </button>
                </div>

                {/* 4. Фото-карточка */}
                <div className="shop-item-card">
                    <div className="shop-item-name">🖼 Фото-карточка</div>
                    <div className="shop-item-desc">
                        {shop.card_photo.url
                            ? 'Наставник видит твоё фото. Можно сменить.'
                            : 'Наставник видит мультяшку. Поставь своё фото.'}
                    </div>
                    <div className="shop-item-price-row">
                        <span className="shop-item-price">✨ {photoAiPrice} 💧 · 📷 {photoRawPrice} 💧</span>
                    </div>
                    <button className="cube-btn-sm" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setPhotoFlow(true); }}>
                        {shop.card_photo.status ? 'Продолжить' : 'Открыть'}
                    </button>
                </div>
            </div>

            {/* Лоты от наставника (legacy; редизайн полки — 8d) */}
            {items.length > 0 && (
                <>
                    <div className="cube-section-title" style={{ marginTop: 12 }}>🎁 От наставника</div>
                    <div className="shop-item-grid">
                        {items.map(item => (
                            <ShopItemCard
                                key={item.id}
                                item={item}
                                buyingId={buyingId}
                                onBuy={handleBuyLot}
                            />
                        ))}
                    </div>
                </>
            )}

            {test === 'unlock' && (
                <DisclaimerTest
                    title="Открыть light-режим?"
                    intro={`Спишется ${unlockPrice} 💧. Активация — со следующего понедельника.`}
                    questions={UNLOCK_QUESTIONS}
                    confirmLabel="открыть light-режим"
                    onPass={doUnlock}
                    onCancel={() => setTest(null)}
                />
            )}
            {test === 'lock' && (
                <DisclaimerTest
                    title="Закрыть light-режим?"
                    intro={`Спишется ${lockPrice} 💧. Main-only — со следующего понедельника.`}
                    questions={LOCK_QUESTIONS}
                    confirmLabel="закрыть light-режим"
                    onPass={doLock}
                    onCancel={() => setTest(null)}
                />
            )}

            {photoFlow && (
                <CardPhotoFlow
                    card={shop.card_photo}
                    balance={shop.drops_balance}
                    aiPrice={photoAiPrice}
                    rawPrice={photoRawPrice}
                    rerollPrice={rerollPrice}
                    onClose={() => { setPhotoFlow(false); refreshShop(); }}
                    onChanged={refreshShop}
                />
            )}
        </>
    );
};

/* ============================================================
   RESPONSIBLE SHOP
   ============================================================ */
const ResponsibleShop: React.FC = () => {
    const subscription = useAuthStore((s) => s.subscription);
    const subActive = subscription?.active ?? false;
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
        // Player activity is driven by the logged-in Responsible's subscription,
        // not per-player expiry. Individually evicted players are still excluded.
        if (!subActive) { setLoadingPlayers(false); return; }
        getMyPlayers()
            .then(ps => {
                const active = ps.filter(p => !p.is_deactivated);
                setPlayers(active);
                if (active.length > 0) setSelectedPlayer(active[0]);
            })
            .catch(() => {})
            .finally(() => setLoadingPlayers(false));
    }, [subActive]);

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

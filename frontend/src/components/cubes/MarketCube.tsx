import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { buyFreeze, getPlayerShop } from '../../api/shop';
import type { PlayerShopState } from '../../api/shop';
import { buyShelfItem, fulfillShelfItem, getItemVideoUrl, hideShelfItem } from '../../api/shelf';
import type { ShelfItem } from '../../api/shelf';
import { getSchedule, unlockLight, lockLight, type ScheduleState } from '../../api/schedule';
import DisclaimerTest, { UNLOCK_QUESTIONS, LOCK_QUESTIONS } from '../schedule/DisclaimerTest';
import CardPhotoFlow from './CardPhotoFlow';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import MentorPlayerPage from './MentorPlayerPage';
import DropPackModal from './DropPackModal';
import PromiseRecorder from './PromiseRecorder';
import { getShelfCatalog } from '../../api/shelf';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import RoleTransition from '../shared/RoleTransition';
import '../../styles/cubes.css';
import '../../styles/shelf.css';
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
 * Ниже — полка наставника (8d): лоты пары + «Мои покупки».
 * Заглушки «Оплата Stars / TON скоро» убраны из витрины игрока.
 */
const PlayerShop: React.FC = () => {
    const [shop, setShop] = useState<PlayerShopState | null>(null);
    const [sched, setSched] = useState<ScheduleState | null>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [toast, setToast] = useState('');
    const [busy, setBusy] = useState(false);
    const [buyingId, setBuyingId] = useState<string | null>(null);
    const [test, setTest] = useState<'unlock' | 'lock' | null>(null);
    const [photoFlow, setPhotoFlow] = useState(false);
    // 8d: отчёт по исполненному обещанию (опциональное видео)
    const [reportFor, setReportFor] = useState<ShelfItem | null>(null);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    }, []);

    const load = useCallback(() => {
        setLoading(true);
        setFetchError(false);
        Promise.all([getPlayerShop(), getSchedule()])
            .then(([s, sc]) => { setShop(s); setSched(sc); })
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

    /* ---------- 8d: полка наставника ---------- */

    const buyLot = useCallback(async (item: ShelfItem) => {
        if (buyingId) return;
        setBuyingId(item.id);
        try {
            const res = await buyShelfItem(item.id);
            hapticNotification('success');
            showToast(res.status === 'purchased'
                ? '🎬 Куплено! Наставник получил «к исполнению»'
                : '🎁 Куплено!');
            refreshShop();
        } catch (e: any) { failToast(e, 'Не удалось купить'); }
        finally { setBuyingId(null); }
    }, [buyingId, showToast, failToast, refreshShop]);

    const hideLot = useCallback(async (item: ShelfItem) => {
        if (buyingId) return;
        setBuyingId(item.id);
        try {
            await hideShelfItem(item.id);
            showToast('Скрыто. Наставник уведомлён');
            refreshShop();
        } catch (e: any) { failToast(e, 'Не удалось скрыть'); }
        finally { setBuyingId(null); }
    }, [buyingId, showToast, failToast, refreshShop]);

    const markDone = useCallback(async (item: ShelfItem, video: Blob | null) => {
        if (buyingId) return;
        setBuyingId(item.id);
        try {
            await fulfillShelfItem(item.id, video);
            hapticNotification('success');
            showToast('✅ Отмечено выполненным');
            setReportFor(null);
            refreshShop();
        } catch (e: any) { failToast(e, 'Не удалось отметить'); }
        finally { setBuyingId(null); }
    }, [buyingId, showToast, failToast, refreshShop]);

    const openVideo = useCallback(async (item: ShelfItem, kind: 'promise' | 'report') => {
        try {
            const url = await getItemVideoUrl(item.id, kind);
            const tg = (window as any).Telegram?.WebApp;
            if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank');
        } catch { showToast('Видео недоступно'); }
    }, [showToast]);

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

            {/* 8d: полка наставника — заменила легаси-секцию «🎁 От наставника» */}
            {shop.shelf.length > 0 && (
                <>
                    <div className="cube-section-title" style={{ marginTop: 12 }}>🎁 Полка наставника</div>
                    <div className="shop-item-grid">
                        {shop.shelf.map(item => {
                            const isBusy = buyingId === item.id;
                            return (
                                <div key={item.id} className="shelf-player-card">
                                    <div className="shelf-player-card-title">
                                        {item.type === 'promise' ? '🎬 ' : '⭐ '}{item.title}
                                    </div>
                                    <div className="shelf-player-card-meta">
                                        {item.price_drops} 💧
                                        {item.type === 'promise' ? ' · реальное обещание наставника' : ''}
                                    </div>
                                    <div className="shelf-player-actions">
                                        {item.has_video && (
                                            <button className="cube-btn-sm" disabled={isBusy}
                                                onClick={(e) => { e.stopPropagation(); openVideo(item, 'promise'); }}>
                                                ▶ Смотреть
                                            </button>
                                        )}
                                        <button className="cube-btn-sm" disabled={isBusy}
                                            onClick={(e) => { e.stopPropagation(); buyLot(item); }}>
                                            {isBusy ? '…' : 'Купить'}
                                        </button>
                                        <button className="cube-btn-sm" disabled={isBusy}
                                            onClick={(e) => { e.stopPropagation(); hideLot(item); }}>
                                            Неинтересно
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* 8d: Мои покупки — ожидающие исполнения + история трат */}
            {shop.my_purchases.length > 0 && (
                <>
                    <div className="cube-section-title" style={{ marginTop: 12 }}>🧾 Мои покупки</div>
                    {shop.my_purchases.map(item => {
                        const isBusy = buyingId === item.id;
                        const pending = item.status === 'purchased';
                        return (
                            <div key={item.id} className="shelf-purchase-row">
                                <div className="shelf-lot-main">
                                    <div className="shelf-lot-title">
                                        {item.type === 'promise' ? '🎬 ' : '⭐ '}{item.title}
                                    </div>
                                    <div className="shelf-lot-meta">
                                        {item.price_drops} 💧 · {pending ? '⏳ ждёт исполнения' : '✅ выполнено'}
                                    </div>
                                    {(item.has_video || item.has_report) && (
                                        <div className="shelf-player-actions" style={{ marginTop: 6 }}>
                                            {item.has_video && (
                                                <button className="cube-btn-sm" disabled={isBusy}
                                                    onClick={(e) => { e.stopPropagation(); openVideo(item, 'promise'); }}>
                                                    💾 В галерею
                                                </button>
                                            )}
                                            {item.has_report && (
                                                <button className="cube-btn-sm" disabled={isBusy}
                                                    onClick={(e) => { e.stopPropagation(); openVideo(item, 'report'); }}>
                                                    🎞 Мой отчёт
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {pending && (
                                    <div className="shelf-player-actions" style={{ flexDirection: 'column' }}>
                                        <button className="cube-btn-sm" disabled={isBusy}
                                            onClick={(e) => { e.stopPropagation(); markDone(item, null); }}>
                                            {isBusy ? '…' : '✅ Выполнено'}
                                        </button>
                                        <button className="cube-btn-sm" disabled={isBusy}
                                            onClick={(e) => { e.stopPropagation(); hapticImpact('light'); setReportFor(item); }}>
                                            🎥 С видеоотчётом
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </>
            )}

            {reportFor && (
                <PromiseRecorder
                    title="Видеоотчёт «как это было»"
                    hint={`«${reportFor.title}» — необязательно, но приятно наставнику.`}
                    confirmLabel="Отметить выполненным"
                    busy={buyingId === reportFor.id}
                    onReady={(blob) => markDone(reportFor, blob)}
                    onCancel={() => setReportFor(null)}
                />
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
    const [loadingPlayers, setLoadingPlayers] = useState(true);
    const [giftBalance, setGiftBalance] = useState(0);
    const [packs, setPacks] = useState(false);
    const [openPlayer, setOpenPlayer] = useState<MyPlayer | null>(null);

    const fetchPlayers = useCallback(() => {
        // Активность игроков определяет подписка наставника, не per-player expiry;
        // индивидуально выселенные всё равно исключаются.
        if (!subActive) { setLoadingPlayers(false); return; }
        getMyPlayers()
            .then(ps => setPlayers(ps.filter(p => !p.is_deactivated)))
            .catch(() => {})
            .finally(() => setLoadingPlayers(false));
    }, [subActive]);

    const fetchPool = useCallback(() => {
        if (!subActive) return;
        getShelfCatalog().then(c => setGiftBalance(c.gift_balance)).catch(() => {});
    }, [subActive]);

    useEffect(() => { fetchPlayers(); fetchPool(); }, [fetchPlayers, fetchPool]);

    if (loadingPlayers) return (
        <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>
    );

    return (
        <>
            {/* Пул капель для подарков. Личный баланс игрока в режиме
                Responsible не показываем (§8.6). */}
            <div className="mentor-pool-row">
                <div>
                    <div className="mentor-pool-value">💧 {giftBalance}</div>
                    <div className="mentor-pool-label">капли для подарков</div>
                </div>
                <button className="cube-btn-sm" disabled={!subActive}
                    onClick={(e) => { e.stopPropagation(); hapticImpact('light'); setPacks(true); }}>
                    Пополнить
                </button>
            </div>

            {players.length === 0 ? (
                <div className="cube-locked">
                    <div className="cube-locked-text">Нет активных игроков</div>
                </div>
            ) : (
                <>
                    <div className="cube-section-title">Полки игроков</div>
                    {players.map(p => (
                        <div key={p.id} className="shelf-purchase-row"
                            style={{ cursor: 'pointer' }}
                            onClick={(e) => { e.stopPropagation(); hapticImpact('light'); setOpenPlayer(p); }}>
                            <div className="shelf-lot-main">
                                <div className="shelf-lot-title">{p.first_name || 'Игрок'}</div>
                                <div className="shelf-lot-meta">открыть полку и подарки</div>
                            </div>
                            {p.pending_promises > 0 && (
                                <span className="shelf-pending-badge">⏳ {p.pending_promises}</span>
                            )}
                            <span style={{ opacity: 0.4, marginLeft: 6 }}>›</span>
                        </div>
                    ))}
                </>
            )}

            {openPlayer && (
                <MentorPlayerPage
                    playerId={openPlayer.id}
                    onClose={() => { setOpenPlayer(null); fetchPlayers(); fetchPool(); }}
                />
            )}
            {packs && <DropPackModal onClose={() => setPacks(false)} onCredited={fetchPool} />}
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

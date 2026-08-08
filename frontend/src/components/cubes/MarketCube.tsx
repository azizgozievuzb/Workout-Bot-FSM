import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { buyFreeze, getPlayerShop } from '../../api/shop';
import type { PlayerShopState } from '../../api/shop';
import { attachShelfReport, buyShelfItem, fulfillShelfItem, hideShelfItem } from '../../api/shelf';
import type { ShelfItem } from '../../api/shelf';
import { getSchedule, unlockLight, lockLight, type ScheduleState } from '../../api/schedule';
import DisclaimerTest, { UNLOCK_QUESTIONS, LOCK_QUESTIONS } from '../schedule/DisclaimerTest';
import CardPhotoFlow from './CardPhotoFlow';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import MentorPlayerScreens from './MentorPlayerScreens';
import DropPackModal from './DropPackModal';
import PromiseRecorder from './PromiseRecorder';
import VideoPlayerModal from './VideoPlayerModal';
import { getShelfCatalog } from '../../api/shelf';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import RoleTransition from '../shared/RoleTransition';
import ConfirmSpendModal from '../shared/ConfirmSpendModal';
import { sendRenewalInvoice } from '../../api/payments';
import '../../styles/cubes.css';
import '../../styles/shelf.css';

type ActiveView = 'player' | 'responsible';

/* Э.6 — подача каналов: «одна фраза на канал, в месте канала». Тексты игрока
   НИКОГДА не упоминают Stars/деньги/траты наставника (инвариант §1). */
const SHELF_SECTION_CAPTION =
    'Наставник выкладывает сюда особенное — то, чего в твоём магазине не бывает. Выкупай за 💧.';
const EMPTY_SHELF_SLOT_TEXT = 'Здесь появится подарок от наставника';

/* 8d.1 (П.8b, находка №26): у Stars-предмета свой текст — «выполнено» это
   статус ОБЕЩАНИЯ, к предмету он приклеился по ошибке. Строка отвечает игроку
   на вопрос «что мне это дало». Дефолт страхует расширение каталога.
   freeze/photo_reroll ушли из каталога полки в эконом-патче №1 (Э.1),
   сброс кулдауна графика — в допостановке v2 (S62-3.1). */
const STAR_ITEM_EFFECT: Record<string, string> = {
    light_trial: '✅ Неделя light-режима',
    title: '✅ Звание получено',
};
const STAR_ITEM_EFFECT_DEFAULT = '✅ Получено';

/* Смоук 8d.1: «Мои покупки» показывали ВСЮ историю пары без лимита. Наверху
   держим только то, где от игрока ещё ждут шага; всё остальное — чек, ему
   место в свёрнутой истории. Признак «ждут шага» ровно один: у карточки есть
   главная кнопка (галочка или отчёт). Stars-предметы её не имеют никогда —
   их эффект применяется в момент покупки, а остаток заморозок и так виден
   отдельной цифрой на карточке «Заморозка стрика». */
function isActionablePurchase(item: ShelfItem): boolean {
    if (item.type !== 'promise') return false;
    if (item.status === 'purchased') return true;                  // ждёт галочки
    return item.status === 'fulfilled' && !item.has_report;        // ждёт отчёта
}

type VideoTarget = {
    itemId: string; kind: 'promise' | 'report'; title: string;
    /** Невыкупленное обещание — только просмотр (решение смоука 8d.1). */
    allowDownload?: boolean;
};

/** П.7: одно окно на все необратимые траты витрины/полки. */
type SpendConfirm = {
    title: string;
    price: number;
    note?: string;
    confirmLabel?: string;
    run: () => Promise<void>;
};

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
 * Ниже — полка наставника (8d) + «Мои покупки».
 * 8d.1: полка видна всегда (П.7), карточка фото — «хамелеон» (П.8a),
 * видео смотрим во встроенном плеере (П.6a), кнопки покупок — по иерархии (П.8c).
 */
const PlayerShop: React.FC = () => {
    const [shop, setShop] = useState<PlayerShopState | null>(null);
    const [sched, setSched] = useState<ScheduleState | null>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [toast, setToast] = useState('');
    const [busy, setBusy] = useState(false);
    // {id, action} — иначе «…» садилось на «Купить» при любом действии с лотом
    // и выглядело как списание, которого не было (смоук 8d, находка №21).
    const [acting, setActing] = useState<{ id: string; action: 'buy' | 'hide' | 'done' | 'report' } | null>(null);
    const [test, setTest] = useState<'unlock' | 'lock' | null>(null);
    const [photoFlow, setPhotoFlow] = useState(false);
    // 8d.1 (П.8c): отчёт — всегда ОТДЕЛЬНЫЙ шаг после галочки (Д6). Прежняя
    // кнопка «🎥 С видеоотчётом» рядом с «✅ Выполнено» ставила игрока перед
    // выбором из двух равных действий — теперь карточка ведёт по шагам.
    const [reportFor, setReportFor] = useState<ShelfItem | null>(null);
    const [reportError, setReportError] = useState('');
    const [reportProgress, setReportProgress] = useState<number | null>(null);
    const [playing, setPlaying] = useState<VideoTarget | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    /* П.7: подтверждение необратимой траты капель. Показывается ВСЕГДА —
       «не спрашивать» не существует ни в каком виде (решение S62). */
    const [confirm, setConfirm] = useState<SpendConfirm | null>(null);

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
            /* HTTP-код в тексте: на смоуке 8d.1 «Не удалось отметить» стоило
               целого круга переписки, чтобы выяснить, что это 400 от парсера
               тела. На телефоне консоли нет — пусть код будет виден глазу. */
            const status = e?.response?.status;
            showToast(status ? `${fallback} (HTTP ${status})` : fallback);
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
        finally { setBusy(false); setConfirm(null); }
    }, [busy, showToast, failToast]);

    /* ---------- 8d: полка наставника ---------- */

    const buyLot = useCallback(async (item: ShelfItem) => {
        if (acting) return;
        setActing({ id: item.id, action: 'buy' });
        try {
            const res = await buyShelfItem(item.id);
            hapticNotification('success');
            showToast(res.status === 'purchased'
                ? '🎬 Куплено! Наставник получил «к исполнению»'
                : '🎁 Куплено!');
            refreshShop();
        } catch (e: any) { failToast(e, 'Не удалось купить'); }
        finally { setActing(null); setConfirm(null); }
    }, [acting, showToast, failToast, refreshShop]);

    /* П.7: между тапом и списанием всегда стоит окно с ценой и остатком. */
    const askBuyLot = useCallback((item: ShelfItem) => {
        hapticImpact('light');
        setConfirm({
            title: item.type === 'promise' ? `🎬 ${item.title}` : `⭐ ${item.title}`,
            price: item.price_drops,
            note: item.type === 'promise'
                ? 'Наставник получит «к исполнению» — обещание нужно будет выполнить.'
                : undefined,
            run: () => buyLot(item),
        });
    }, [buyLot]);

    const hideLot = useCallback(async (item: ShelfItem) => {
        if (acting) return;
        setActing({ id: item.id, action: 'hide' });
        try {
            await hideShelfItem(item.id);
            showToast('Скрыто. Наставник уведомлён');
            refreshShop();
        } catch (e: any) { failToast(e, 'Не удалось скрыть'); }
        finally { setActing(null); }
    }, [acting, showToast, failToast, refreshShop]);

    const markDone = useCallback(async (item: ShelfItem) => {
        if (acting) return;
        setActing({ id: item.id, action: 'done' });
        try {
            await fulfillShelfItem(item.id);
            hapticNotification('success');
            showToast('✅ Отмечено выполненным');
            refreshShop();
        } catch (e: any) {
            const d = e?.response?.data?.detail;
            const code = typeof d === 'object' ? d?.code : '';
            console.error('[shelf] fulfill failed', e?.response?.status, d ?? e?.message);
            failToast(e, code === 'NOT_PENDING' ? 'Обещание уже отмечено' : 'Не удалось отметить');
        }
        finally { setActing(null); }
    }, [acting, showToast, failToast, refreshShop]);

    /* Д6: отчёт ПОСЛЕ галочки — отдельный шаг, репутацию повторно не растит. */
    const attachReport = useCallback(async (item: ShelfItem, video: Blob) => {
        if (acting) return;
        setActing({ id: item.id, action: 'report' }); setReportError(''); setReportProgress(0);
        try {
            await attachShelfReport(item.id, video, setReportProgress);
            hapticNotification('success');
            showToast('🎥 Отчёт приложен');
            setReportFor(null);
            refreshShop();
        } catch (e: any) {
            hapticNotification('error');
            const d = e?.response?.data?.detail;
            const code = typeof d === 'object' ? d?.code : '';
            console.error('[shelf] attach report failed', e?.response?.status, d ?? e?.message);
            setReportError(
                code === 'VIDEO_TOO_LARGE' ? 'Видео больше 30 МБ — снимите короче'
                    : code === 'REPORT_EXISTS' ? 'Отчёт уже приложен'
                        : 'Не удалось приложить отчёт',
            );
        }
        finally { setActing(null); setReportProgress(null); }
    }, [acting, showToast, refreshShop]);

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

    // П.8a: карточка-хамелеон. Флоу в процессе → «Продолжить» (резюм/реролл),
    // фото уже стоит → миниатюра + «установлено» + «Сменить» по актуальной цене.
    const photoFlowPending = Boolean(shop.card_photo.status);
    const photoInstalled = Boolean(shop.card_photo.url) && !photoFlowPending;

    // П.7: пустые слоты полки рисуем всегда, пока есть наставник.
    const emptyShelfSlots = shop.has_mentor
        ? Math.max(0, shop.shelf_slots_total - shop.shelf.length)
        : 0;

    /* Одна карточка «Моих покупок» — рисуется и в активных, и в истории. */
    const renderPurchase = (item: ShelfItem) => {
        const mine = acting?.id === item.id ? acting.action : null;
        const isBusy = acting !== null;
        const pending = item.status === 'purchased';
        const isPromise = item.type === 'promise';
        const needsReport = isPromise && !pending && !item.has_report && item.status === 'fulfilled';
        const closed = isPromise && !pending && !needsReport;

        const statusLine = !isPromise
            ? (STAR_ITEM_EFFECT[item.star_catalog_key ?? ''] ?? STAR_ITEM_EFFECT_DEFAULT)
            : pending ? '⏳ ждёт исполнения' : '✅ выполнено';

        return (
            <div key={item.id} className="shelf-purchase-card">
                <div className="shelf-lot-title">
                    {isPromise ? '🎬 ' : '⭐ '}{item.title}
                </div>
                <div className="shelf-lot-meta">{item.price_drops} 💧 · {statusLine}</div>

                {/* Главная кнопка текущего шага — во всю ширину */}
                {pending && (
                    <button className="purchase-main-btn" disabled={isBusy}
                        onClick={(e) => { e.stopPropagation(); markDone(item); }}>
                        {mine === 'done' ? 'Отмечаем…' : '✓ Отметить выполненным'}
                    </button>
                )}
                {needsReport && (
                    <button className="purchase-main-btn" disabled={isBusy}
                        onClick={(e) => {
                            e.stopPropagation(); hapticImpact('light');
                            setReportFor(item);
                        }}>
                        {mine === 'report' ? 'Загружаем…' : '🎥 Приложить отчёт'}
                    </button>
                )}

                {/* Вторичные — мелкие в ряд */}
                <div className="purchase-mini-row">
                    {pending && item.has_video && (
                        <button className="cube-btn-sm" disabled={isBusy}
                            onClick={(e) => {
                                e.stopPropagation();
                                setPlaying({ itemId: item.id, kind: 'promise', title: `Обещание «${item.title}»` });
                            }}>▶︎ Смотреть</button>
                    )}
                    {closed && item.has_video && (
                        <button className="cube-btn-sm" disabled={isBusy}
                            onClick={(e) => {
                                e.stopPropagation();
                                setPlaying({ itemId: item.id, kind: 'promise', title: `Обещание «${item.title}»` });
                            }}>▶︎ Обещание</button>
                    )}
                    {closed && item.has_report && (
                        <button className="cube-btn-sm" disabled={isBusy}
                            onClick={(e) => {
                                e.stopPropagation();
                                setPlaying({ itemId: item.id, kind: 'report', title: `Мой отчёт «${item.title}»` });
                            }}>▶︎ Мой отчёт</button>
                    )}
                    {/* «⬇ Скачать» здесь БЫЛА и убрана (смоук 8d.1): она
                        двусмысленна — рядом два ролика, а кнопка одна, и
                        качала только обещание. Скачивание живёт внутри
                        плеера, где видно, что именно качаешь. */}
                </div>
            </div>
        );
    };

    return (
        <>
            {/* Шапка: баланс капель — постоянно видим (UX-долг №5) */}
            <div className="market-balance-header">
                <span className="market-balance-value">💧 {shop.drops_balance}</span>
                <span className="market-balance-label">твои капли</span>
            </div>

            {toast && <div className="admin-toast">{toast}</div>}

            {/* Э.4: витрина — сетка ячеек-слотов в стиле полки наставника.
                Слотовость здесь ВИЗУАЛЬНЫЙ ЯЗЫК: ассортимент, цены и доступность
                не меняются, ротации и таймеров нет (отклонены осознанно). */}
            <div className="shop-item-grid shop-item-grid--slots">
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
                        onClick={(e) => {
                            e.stopPropagation();
                            hapticImpact('light');
                            setConfirm({
                                title: '❄️ Заморозка',
                                price: freezePrice,
                                note: 'Спасёт стрик в пропущенный плановый день.',
                                run: doBuyFreeze,
                            });
                        }}>
                        {freezeCapReached ? 'Запас полон' : busy ? '…' : 'Купить'}
                    </button>
                </div>

                {/* 4. Фото-карточка — хамелеон по состоянию (П.8a, находка №25) */}
                <div className="shop-item-card">
                    <div className="shop-item-name">🖼 Фото-карточка</div>
                    {photoInstalled ? (
                        <>
                            <img className="photo-card-thumb" src={shop.card_photo.url!}
                                alt="Твоя фото-карточка" />
                            <div className="photo-card-installed">установлено</div>
                            <div className="shop-item-desc">Так тебя видит наставник.</div>
                        </>
                    ) : (
                        <div className="shop-item-desc">
                            {photoFlowPending
                                ? 'Смена фото не закончена — продолжи с того же места.'
                                : 'Наставник видит мультяшку. Поставь своё фото.'}
                        </div>
                    )}
                    <div className="shop-item-price-row">
                        <span className="shop-item-price">✨ {photoAiPrice} 💧 · 📷 {photoRawPrice} 💧</span>
                    </div>
                    {/* Подаренная наставником попытка тратится на шаге «ещё 2 варианта»,
                        а не на самой покупке фото — без этой строки игрок ждал, что
                        карточка станет бесплатной (смоук 8d.1, п.12). */}
                    {shop.reroll_credits > 0 && (
                        <div className="shop-item-desc">
                            🎁 От наставника: {shop.reroll_credits} бесплатн{shop.reroll_credits === 1 ? 'ая попытка' : 'ых попытки'} обновить
                            варианты — тратится внутри, на шаге «ещё 2 варианта».
                        </div>
                    )}
                    <button className="cube-btn-sm" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setPhotoFlow(true); }}>
                        {photoFlowPending ? 'Продолжить' : photoInstalled ? 'Сменить' : 'Открыть'}
                    </button>
                </div>
            </div>

            {/* 8d.1 (П.7): секция полки видна ВСЕГДА при живом партнёрстве —
                пустые слоты рисуются пунктирными заглушками, иначе механика
                оставалась невидимкой (находка №23). Э.6: постоянная подпись
                объясняет, чем полка отличается от витрины. */}
            {shop.has_mentor && (
                <>
                    <div className="cube-section-title" style={{ marginTop: 12 }}>🎁 Полка наставника</div>
                    <div className="cube-hint">{SHELF_SECTION_CAPTION}</div>
                    <div className="shop-item-grid shop-item-grid--slots">
                        {shop.shelf.map(item => {
                            const mine = acting?.id === item.id ? acting.action : null;
                            const isBusy = acting !== null;
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
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPlaying({
                                                        itemId: item.id, kind: 'promise',
                                                        title: `Обещание «${item.title}»`,
                                                        allowDownload: false,
                                                    });
                                                }}>
                                                ▶︎ Смотреть
                                            </button>
                                        )}
                                        <button
                                            className="cube-btn-sm"
                                            disabled={isBusy}
                                            onClick={(e) => { e.stopPropagation(); askBuyLot(item); }}>
                                            {mine === 'buy' ? 'Покупаем…' : 'Купить'}
                                        </button>
                                        <button className="cube-btn-sm" disabled={isBusy}
                                            onClick={(e) => { e.stopPropagation(); hideLot(item); }}>
                                            {mine === 'hide' ? 'Скрываем…' : 'Неинтересно'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {Array.from({ length: emptyShelfSlots }, (_, i) => (
                            <div key={`slot-${i}`} className="shelf-slot-placeholder">
                                {EMPTY_SHELF_SLOT_TEXT}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* 8d: Мои покупки — ожидающие исполнения + история трат.
                8d.1 (П.8c, находка №19): одна крупная кнопка текущего шага,
                вторичные — мелкие в ряд; карточка сама ведёт по шагам. */}
            {shop.my_purchases.length > 0 && (
                <>
                    <div className="cube-section-title" style={{ marginTop: 12 }}>🧾 Мои покупки</div>
                    {(() => {
                        /* Смоук 8d.1: бэк отдаёт сюда ВСЮ историю пары без лимита, и
                           через несколько месяцев экран превращался в простыню.
                           Наверху остаётся то, где от игрока ещё ждут действия;
                           карточка без единой кнопки — это чек, ему место в истории. */
                        const actionable = shop.my_purchases.filter(isActionablePurchase);
                        const history = shop.my_purchases.filter((i) => !isActionablePurchase(i));
                        return (
                            <>
                                {actionable.length === 0 && history.length > 0 && (
                                    <div className="cube-hint">Ничего не ждёт твоего шага.</div>
                                )}
                                {actionable.map(renderPurchase)}
                                {history.length > 0 && (
                                    <button className="mentor-more-link"
                                        onClick={(e) => { e.stopPropagation(); setShowHistory((v) => !v); }}>
                                        {showHistory ? 'Скрыть историю' : `Показать историю (${history.length}) →`}
                                    </button>
                                )}
                                {showHistory && history.map(renderPurchase)}
                            </>
                        );
                    })()}
                </>
            )}

            {reportFor && (
                <PromiseRecorder
                    title="Видеоотчёт «как это было»"
                    hint={`«${reportFor.title}» — покажи наставнику, как всё прошло.`}
                    confirmLabel="Приложить отчёт"
                    busy={acting?.id === reportFor.id}
                    error={reportError}
                    progress={reportProgress}
                    onReady={(blob) => attachReport(reportFor, blob)}
                    onCancel={() => { setReportFor(null); setReportError(''); }}
                />
            )}

            {playing && (
                <VideoPlayerModal
                    itemId={playing.itemId} kind={playing.kind} title={playing.title}
                    allowDownload={playing.allowDownload !== false}
                    onClose={() => setPlaying(null)} onError={showToast}
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

            {confirm && (
                <ConfirmSpendModal
                    title={confirm.title}
                    price={confirm.price}
                    balance={shop.drops_balance}
                    note={confirm.note}
                    confirmLabel={confirm.confirmLabel}
                    busy={busy || acting !== null}
                    onConfirm={() => { void confirm.run(); }}
                    onCancel={() => setConfirm(null)}
                />
            )}

            {photoFlow && (
                <CardPhotoFlow
                    card={shop.card_photo}
                    balance={shop.drops_balance}
                    aiPrice={photoAiPrice}
                    rawPrice={photoRawPrice}
                    rerollPrice={rerollPrice}
                    rerollCredits={shop.reroll_credits}
                    onClose={() => { setPhotoFlow(false); refreshShop(); }}
                    onChanged={refreshShop}
                />
            )}
        </>
    );
};

/* ============================================================
   RESPONSIBLE SHOP — магазин наставника (8d.1 П.1a)
   ============================================================ */
/* Тап по игроку ведёт СРАЗУ на его полку: Market = «где я управляю подарками».
   Бейдж «⏳ N» переехал сюда из Action (Д1) — долги по обещаниям это метрика
   полки, а не наблюдения. */
/* Э.3.2: над пулом капель — индикатор подписки «Тариф · осталось N дн ·
   [Продлить]». Виден ТОЛЬКО здесь, в режиме R: игроку про деньги и сроки
   наставника не показываем ничего (инвариант §1). */
const TIER_LABELS: Record<string, string> = {
    standard: 'Standard', premium: 'Premium', elite: 'Elite',
};

const ResponsibleShop: React.FC = () => {
    const subscription = useAuthStore((s) => s.subscription);
    const subActive = subscription?.active ?? false;
    const [players, setPlayers] = useState<MyPlayer[]>([]);
    const [loadingPlayers, setLoadingPlayers] = useState(true);
    const [giftBalance, setGiftBalance] = useState(0);
    const [sub, setSub] = useState<{ tier: string | null; days: number | null; warn: boolean } | null>(null);
    const [renewBusy, setRenewBusy] = useState(false);
    const [toast, setToast] = useState('');
    const [packs, setPacks] = useState(false);
    const [openPlayer, setOpenPlayer] = useState<MyPlayer | null>(null);

    const show = useCallback((m: string) => {
        setToast(m);
        setTimeout(() => setToast(''), 3000);
    }, []);

    const renew = useCallback(async () => {
        if (renewBusy) return;
        setRenewBusy(true);
        try {
            await sendRenewalInvoice();
            hapticNotification('success');
            show('💳 Счёт продления отправлен в чат с ботом');
        } catch {
            hapticNotification('error');
            show('Не удалось отправить счёт');
        } finally { setRenewBusy(false); }
    }, [renewBusy, show]);

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
        getShelfCatalog()
            .then(c => {
                setGiftBalance(c.gift_balance);
                setSub({
                    tier: c.tier,
                    days: c.subscription_days_left,
                    warn: c.subscription_warn,
                });
            })
            .catch(() => {});
    }, [subActive]);

    useEffect(() => { fetchPlayers(); fetchPool(); }, [fetchPlayers, fetchPool]);

    if (loadingPlayers) return (
        <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>
    );

    return (
        <>
            {toast && <div className="admin-toast">{toast}</div>}

            {/* Э.3.2: остаток подписки — в месте траты (слоты полки зависят от
                тарифа). Красноту решает бэк, фронт про «3 дня» не знает. */}
            {sub && sub.days !== null && (
                <div className={`mentor-sub-row${sub.warn ? ' mentor-sub-row--warn' : ''}`}>
                    <span className="mentor-sub-text">
                        Тариф {TIER_LABELS[sub.tier ?? ''] ?? sub.tier ?? '—'} · осталось {sub.days} дн
                    </span>
                    <button className="cube-btn-sm" disabled={renewBusy}
                        onClick={(e) => { e.stopPropagation(); hapticImpact('light'); renew(); }}>
                        {renewBusy ? '…' : 'Продлить'}
                    </button>
                </div>
            )}

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
                            {/* 8d.1a: строка Market отражает СОСТОЯНИЕ ПОЛКИ — занятость
                                слотов видна до захода, красная при полноте. */}
                            {p.shelf_slots_total > 0 && (
                                <span className={`shelf-slots-badge${
                                    p.shelf_slots_used >= p.shelf_slots_total ? ' shelf-slots-badge--full' : ''
                                }`}>
                                    🎁 {p.shelf_slots_used}/{p.shelf_slots_total}
                                </span>
                            )}
                            {p.pending_promises > 0 && (
                                <span className="shelf-pending-badge">⏳ {p.pending_promises}</span>
                            )}
                            <span style={{ opacity: 0.4, marginLeft: 6 }}>›</span>
                        </div>
                    ))}
                </>
            )}

            {openPlayer && (
                <MentorPlayerScreens
                    playerId={openPlayer.id}
                    initial="shelf"
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

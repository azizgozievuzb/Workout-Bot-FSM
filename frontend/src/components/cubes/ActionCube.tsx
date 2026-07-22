import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import api from '../../api/client';
import { getMyStats } from '../../api/stats';
import type { PlayerStats } from '../../api/stats';
import { getActiveBoost } from '../../api/boosts';
import type { ActiveBoost } from '../../api/boosts';
import { getProducts, createInvoice, getPayment } from '../../api/payments';
import type { StarProduct } from '../../api/payments';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import { playerAvatarUrl } from '../../utils/playerAvatar';
import { useTheme } from '../../contexts/ThemeContext';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import RoleTransition from '../shared/RoleTransition';
import GiftFreezeModal from './GiftFreezeModal';
import WorkoutScreen from '../workout/WorkoutScreen';
import '../../styles/cubes.css';

type ActiveView = 'player' | 'responsible';

const ActionCube: React.FC = () => {
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

    const toggleView = () => {
        const next: ActiveView = view === 'player' ? 'responsible' : 'player';
        setActiveRoleView(next);
    };

    return (
        <div className="cube-module">
            <RoleTransition
                view={view}
                dual={dual}
                onToggle={toggleView}
                lockedMessage={view === 'player'
                    ? 'Вам нужна пригласительная ссылка от наставника'
                    : 'Оформите подписку, чтобы приглашать игроков'}
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

const TIER_LABELS: Record<string, string> = { standard: 'STD', premium: 'PRM', elite: 'ELT' };

const PlayerView: React.FC = () => {
    const effectiveTier = useAuthStore((s) => s.effectiveTier());
    const daysLeft = useAuthStore((s) => s.daysLeft);
    const streakFreezeBalance = useAuthStore((s) => s.streakFreezeBalance);
    const restDaysRemaining = useAuthStore((s) => s.restDaysRemaining);
    const gender = useAuthStore((s) => s.gender);
    const setRestDaysRemaining = useAuthStore((s) => s.setRestDaysRemaining);

    const [stats, setStats] = useState<PlayerStats | null>(null);
    const [boost, setBoost] = useState<ActiveBoost | null>(null);
    const [loading, setLoading] = useState(true);
    const [restDayInFlight, setRestDayInFlight] = useState(false);
    const [restDayToast, setRestDayToast] = useState('');
    const [workoutOpen, setWorkoutOpen] = useState(false);

    const handleStartWorkout = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        hapticImpact('medium');
        setWorkoutOpen(true);
    }, []);

    useEffect(() => {
        let done = 0;
        const check = () => { if (++done >= 2) setLoading(false); };
        getMyStats().then(setStats).catch(() => {}).finally(check);
        getActiveBoost().then(setBoost).catch(() => {}).finally(check);
    }, []);

    const handleUseRestDay = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (restDayInFlight) return;
        hapticImpact('medium');
        setRestDayInFlight(true);
        try {
            await api.post('/player/use-rest-day');
            setRestDaysRemaining(restDaysRemaining - 1);
            hapticNotification('success');
            setRestDayToast('День отдыха использован');
        } catch (err: any) {
            const code = err?.response?.data?.detail?.code;
            if (code === 'NO_REST_DAYS_LEFT' || code === 'REST_DAY_NOT_AVAILABLE') {
                setRestDayToast('Нет доступных дней отдыха');
            } else if (code === 'NOT_ELIGIBLE') {
                // gender guard fired server-side — hide button locally
                setRestDaysRemaining(0);
            } else {
                setRestDayToast('Не удалось использовать день отдыха');
            }
            hapticNotification('error');
        } finally {
            setRestDayInFlight(false);
            setTimeout(() => setRestDayToast(''), 3000);
        }
    }, [restDayInFlight, restDaysRemaining, setRestDaysRemaining]);

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;
    if (!stats) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Не удалось загрузить</div>;

    const daysChipVariant = (() => {
        if (daysLeft === null) return null;
        if (daysLeft <= 0) return 'red';
        if (daysLeft <= 7) return 'red pulse';
        if (daysLeft <= 14) return 'yellow';
        return 'green';
    })();

    return (
        <>
            {/* A. Status row */}
            <div className="player-status-row">
                {effectiveTier && (
                    <div className={`player-tier-chip player-tier-chip--${effectiveTier}`}>
                        {TIER_LABELS[effectiveTier] ?? effectiveTier.toUpperCase()}
                    </div>
                )}
                {daysLeft !== null && daysChipVariant && (
                    <div className={`player-days-chip${daysChipVariant.includes('pulse') ? ' player-days-chip--pulse' : ''} player-days-chip--${daysChipVariant.replace(' pulse', '')}`}>
                        {daysLeft <= 0 ? 'Истёк' : `📅 ${daysLeft} дн.`}
                    </div>
                )}
                {streakFreezeBalance > 0 && (
                    <div className="player-freeze-chip">
                        ❄️ {streakFreezeBalance}
                    </div>
                )}
            </div>

            {/* B. Rest-day button */}
            {restDaysRemaining > 0 && gender === 'female' && (
                <button
                    className="rest-day-btn"
                    onClick={handleUseRestDay}
                    disabled={restDayInFlight}
                >
                    {restDayInFlight
                        ? '...'
                        : `Использовать день отдыха (осталось: ${restDaysRemaining})`}
                </button>
            )}
            {restDayToast && <div className="admin-toast">{restDayToast}</div>}

            {/* D. Workout entry point */}
            <button className="cube-btn-primary" onClick={handleStartWorkout}>
                Приступим
            </button>

            {workoutOpen && <WorkoutScreen onClose={() => setWorkoutOpen(false)} />}

            <div className="cube-card">
                <div className="cube-stat">
                    <span>Стрик</span>
                    <span className="cube-stat-value">
                        {stats.current_streak} {stats.current_streak === 1 ? 'день' : stats.current_streak < 5 ? 'дня' : 'дней'}
                    </span>
                </div>
            </div>

            {boost && boost.active && (
                <div className="cube-card">
                    <div className="cube-stat">
                        <span>Буст X2</span>
                        <span className="cube-stat-value" style={{ color: '#CCFF00' }}>
                            активен {Math.ceil(boost.hours_left || 0)}ч
                        </span>
                    </div>
                </div>
            )}

            <div className="cube-funfact">
                Знаешь ли ты, что регулярные тренировки улучшают качество сна на 65%? Твоё тело скажет спасибо!
            </div>
        </>
    );
};

/* ---------- RESPONSIBLE ---------- */

const TIER_PLAYER_LIMITS: Record<string, number> = { standard: 1, premium: 2, elite: 3 };

type ModalKind = 'gift';

const ResponsibleView: React.FC = () => {
    const theme = useTheme();
    const ownAccessTier = useAuthStore((s) => s.ownAccessTier);
    const shopFreezeBalance = useAuthStore((s) => s.shopFreezeBalance);
    const giftFreezeBalance = useAuthStore((s) => s.giftFreezeBalance);
    const subscription = useAuthStore((s) => s.subscription);
    const subActive = subscription?.active ?? false;
    const [players, setPlayers] = useState<MyPlayer[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState('');
    const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
    const [modal, setModal] = useState<{ kind: ModalKind; partnershipId?: string; targetUserId?: string; playerName?: string | null } | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Boost purchase (Telegram Stars)
    const [boostModal, setBoostModal] = useState<{ playerId: string; playerName: string } | null>(null);
    const [products, setProducts] = useState<StarProduct[]>([]);
    const [boostBusy, setBoostBusy] = useState(false);

    const fetchPlayers = useCallback(() => {
        getMyPlayers()
            .then(setPlayers)
            .catch(() => {});
    }, []);

    useEffect(() => {
        getMyPlayers().then(setPlayers).catch(() => {});
        setLoading(false);
    }, []);

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') fetchPlayers();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [fetchPlayers]);

    useEffect(() => {
        if (!openMenuFor) return;
        const onDocClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpenMenuFor(null);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [openMenuFor]);

    useEffect(() => {
        getProducts().then(setProducts).catch(() => {});
    }, []);

    const openBoostModal = useCallback((e: React.MouseEvent, playerId: string, playerName: string) => {
        e.stopPropagation();
        hapticImpact('light');
        setBoostModal({ playerId, playerName });
    }, []);

    // Poll our own DB — the Telegram callback status is NOT the source of truth.
    const pollPaymentStatus = useCallback(async (paymentId: string): Promise<string> => {
        for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
                const { status } = await getPayment(paymentId);
                if (status === 'fulfilled') return 'fulfilled';
                if (status === 'failed' || status === 'refunded') return status;
            } catch { /* keep polling */ }
        }
        return 'timeout';
    }, []);

    const buyBoostProduct = useCallback(async (productType: string) => {
        if (!boostModal || boostBusy) return;
        const { playerId } = boostModal;
        setBoostBusy(true);
        try {
            const { payment_id, invoice_link } = await createInvoice(productType, playerId);
            const tg = (window as any).Telegram?.WebApp;
            if (!tg?.openInvoice) {
                setToast('Оплата недоступна в этом клиенте');
                setBoostBusy(false);
                setBoostModal(null);
                setTimeout(() => setToast(''), 3000);
                return;
            }
            tg.openInvoice(invoice_link, async (status: string) => {
                if (status === 'paid') {
                    setToast('Оплата получена, активируем буст...');
                    const result = await pollPaymentStatus(payment_id);
                    if (result === 'fulfilled') {
                        hapticNotification('success');
                        setToast('⚡ Буст X2 активирован!');
                    } else if (result === 'timeout') {
                        setToast('Оплата обрабатывается, буст активируется автоматически');
                    } else {
                        setToast('Не удалось активировать буст');
                    }
                } else if (status === 'cancelled') {
                    setToast('Покупка отменена');
                } else {
                    setToast('Оплата не прошла');
                }
                setBoostBusy(false);
                setBoostModal(null);
                setTimeout(() => setToast(''), 4000);
            });
        } catch {
            setToast('Не удалось создать счёт');
            setBoostBusy(false);
            setBoostModal(null);
            setTimeout(() => setToast(''), 3000);
        }
    }, [boostModal, boostBusy, pollPaymentStatus]);

    const openModal = useCallback((kind: ModalKind, p: MyPlayer) => {
        hapticImpact('light');
        setOpenMenuFor(null);
        setModal({
            kind,
            partnershipId: p.partnership_id,
            targetUserId: p.id,
            playerName: p.first_name,
        });
    }, []);

    const closeModal = useCallback(() => setModal(null), []);

    const handleGiftSuccess = useCallback((msg: string) => {
        setModal(null);
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    }, []);

    const slotLimit = TIER_PLAYER_LIMITS[ownAccessTier ?? 'standard'] ?? 1;
    const slotsUsed = players.length;
    const slotsLeft = slotLimit - slotsUsed;

    return (
        <>
            <div className="responsible-wallet-row">
                <div className="wallet-chip">
                    <span className="wallet-chip-label">❄️ Заморозок: {shopFreezeBalance + giftFreezeBalance}</span>
                </div>
            </div>

            {toast && <div className="admin-toast">{toast}</div>}

            <div className="cube-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Мои Игроки</span>
                <span className={`player-slots-badge ${slotsLeft <= 0 ? 'player-slots-badge--full' : ''}`}>
                    {slotsUsed}/{slotLimit}
                </span>
            </div>

            {loading ? (
                <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>
            ) : players.length === 0 ? (
                <div className="cube-locked">
                    <div className="cube-locked-text">Игроки добавляются в кубе Bond → ➕ Добавить игрока</div>
                </div>
            ) : (
                <div className="cube-card">
                    {players.map(p => {
                        const rowClass = [
                            'player-row',
                            (!subActive || p.is_deactivated) ? 'player-row--deactivated' : '',
                        ].filter(Boolean).join(' ');
                        const name = p.first_name || '—';
                        const isActive = subActive && !p.is_deactivated;
                        const avatar = playerAvatarUrl(p, theme);
                        return (
                            <div className={rowClass} key={p.id}>
                                <div className="cube-avatar">
                                    {avatar
                                        ? <img src={avatar} alt={name} />
                                        : name.charAt(0)}
                                </div>
                                <div className="cube-player-info">
                                    <div className="cube-player-name">
                                        {name}
                                    </div>
                                </div>
                                <div className="cube-player-actions" style={{ position: 'relative' }}>
                                    {isActive && (
                                        <button className="cube-btn-sm" onClick={(e) => openBoostModal(e, p.id, name)}>
                                            ⚡X2
                                        </button>
                                    )}
                                    <button
                                        className="player-row-menu-btn"
                                        aria-label="Действия"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            hapticImpact('light');
                                            setOpenMenuFor(openMenuFor === p.id ? null : p.id);
                                        }}
                                    >
                                        ⋮
                                    </button>
                                    {openMenuFor === p.id && (
                                        <div ref={menuRef} className="player-context-menu">
                                            <button
                                                className="player-context-menu-item"
                                                onClick={(e) => { e.stopPropagation(); openModal('gift', p); }}
                                            >
                                                Подарить заморозку
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {modal?.kind === 'gift' && modal.targetUserId && (
                <GiftFreezeModal
                    targetUserId={modal.targetUserId}
                    playerName={modal.playerName ?? null}
                    onClose={closeModal}
                    onSuccess={handleGiftSuccess}
                />
            )}

            {boostModal && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
                    onClick={() => { if (!boostBusy) setBoostModal(null); }}
                >
                    <div
                        className="cube-card"
                        style={{ maxWidth: 360, width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="cube-section-title">⚡ Буст X2 для {boostModal.playerName}</div>
                        {products.length === 0 ? (
                            <div className="cube-player-meta">Загрузка цен…</div>
                        ) : (
                            products.map((pr) => (
                                <button
                                    key={pr.product_type}
                                    className="cube-btn-primary"
                                    disabled={boostBusy}
                                    onClick={() => buyBoostProduct(pr.product_type)}
                                >
                                    {pr.product_type === 'boost_1_day' ? 'День' : pr.product_type === 'boost_1_week' ? 'Неделя' : pr.title} — {pr.price_stars} ⭐
                                </button>
                            ))
                        )}
                        <button className="cube-btn-sm" disabled={boostBusy} onClick={() => setBoostModal(null)}>
                            {boostBusy ? 'Обработка…' : 'Отмена'}
                        </button>
                    </div>
                </div>
            )}
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

import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import api from '../../api/client';
import { getMyStats } from '../../api/stats';
import type { PlayerStats } from '../../api/stats';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import { getPlayerShop, restoreStreak } from '../../api/shop';
import type { PlayerShopState } from '../../api/shop';
import { playerAvatarUrl } from '../../utils/playerAvatar';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import { getShelfCatalog } from '../../api/shelf';
import RoleTransition from '../shared/RoleTransition';
import MentorPlayerPage from './MentorPlayerPage';
import DropPackModal from './DropPackModal';
import WorkoutScreen from '../workout/WorkoutScreen';
import { getSchedule, type ScheduleState } from '../../api/schedule';
import type { SessionType } from '../../api/workout';
import '../../styles/cubes.css';
import '../../styles/shelf.css';

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
    const [loading, setLoading] = useState(true);
    const [restDayInFlight, setRestDayInFlight] = useState(false);
    const [restDayToast, setRestDayToast] = useState('');
    const [workoutType, setWorkoutType] = useState<SessionType | null>(null);
    const [sched, setSched] = useState<ScheduleState | null>(null);
    // 8c: витрина-агрегат — restore-офер после слома стрика
    const [shop, setShop] = useState<PlayerShopState | null>(null);
    const [restoreConfirm, setRestoreConfirm] = useState(false);
    const [restoreBusy, setRestoreBusy] = useState(false);
    const [restoreToast, setRestoreToast] = useState('');

    useEffect(() => {
        getSchedule().then(setSched).catch(() => {});
        getPlayerShop().then(setShop).catch(() => {});
    }, []);

    const doRestore = useCallback(async () => {
        if (restoreBusy) return;
        setRestoreBusy(true);
        try {
            const res = await restoreStreak();
            hapticNotification('success');
            setRestoreToast(`🔥 Стрик восстановлен: ${res.current_streak} дн.`);
            setShop(prev => prev ? { ...prev, drops_balance: res.drops_balance, restore: null } : prev);
            setStats(prev => prev ? { ...prev, current_streak: res.current_streak } : prev);
        } catch (err: any) {
            hapticNotification('error');
            const detail = err?.response?.data?.detail;
            const code = typeof detail === 'object' ? detail?.code : '';
            setRestoreToast(code === 'INSUFFICIENT_DROPS'
                ? `Недостаточно капель (${detail?.balance}/${detail?.price})`
                : 'Восстановление недоступно');
        } finally {
            setRestoreBusy(false);
            setRestoreConfirm(false);
            setTimeout(() => setRestoreToast(''), 4000);
        }
    }, [restoreBusy]);

    const openWorkout = useCallback((e: React.MouseEvent, type: SessionType) => {
        e.stopPropagation();
        hapticImpact('medium');
        setWorkoutType(type);
    }, []);

    useEffect(() => {
        getMyStats().then(setStats).catch(() => {}).finally(() => setLoading(false));
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
                {/* 8c: баланс капель — маленький постоянный бейдж (UX-долг №5) */}
                <div className="player-drops-chip">
                    💧 {shop?.drops_balance ?? stats.drops_balance}
                </div>
            </div>

            {/* 8c: restore-плашка — 72ч после слома стрика */}
            {shop?.restore && (
                <div className="restore-plate">
                    💔 Стрик {shop.restore.lost_streak_len} дн. сгорел.
                    {!restoreConfirm ? (
                        <button
                            className="cube-btn-sm"
                            style={{ display: 'block' }}
                            onClick={(e) => { e.stopPropagation(); hapticImpact('light'); setRestoreConfirm(true); }}
                        >
                            Восстановить за {shop.restore.price} 💧
                        </button>
                    ) : (
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button className="cube-btn-sm" disabled={restoreBusy}
                                onClick={(e) => { e.stopPropagation(); doRestore(); }}>
                                {restoreBusy ? '…' : `Да, вернуть (−${shop.restore.price} 💧)`}
                            </button>
                            <button className="cube-btn-sm" disabled={restoreBusy}
                                onClick={(e) => { e.stopPropagation(); setRestoreConfirm(false); }}>
                                Отмена
                            </button>
                        </div>
                    )}
                </div>
            )}
            {restoreToast && <div className="admin-toast">{restoreToast}</div>}

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

            {/* D. Workout entry point — тип по плановому дню (8b) */}
            {(() => {
                const todayType = sched?.today_session_type ?? null;
                const lightActive = sched?.light_active ?? false;
                const primaryType: SessionType = todayType === 'light' ? 'light' : 'main';
                const primaryLabel = primaryType === 'light' ? '☀️ Лёгкая зарядка' : 'Приступим';
                // Сверхплановый запуск другого типа не блокируем (только если light активен).
                const secondaryType: SessionType | null = lightActive
                    ? (primaryType === 'light' ? 'main' : 'light')
                    : null;
                const secondaryLabel = secondaryType === 'light' ? '☀️ Лёгкая зарядка' : 'Полная тренировка';
                return (
                    <>
                        <button className="cube-btn-primary" onClick={(e) => openWorkout(e, primaryType)}>
                            {primaryLabel}
                        </button>
                        {secondaryType && (
                            <button
                                className="cube-btn-primary"
                                style={{ marginTop: 8, background: 'rgba(255,255,255,0.10)', color: 'inherit' }}
                                onClick={(e) => openWorkout(e, secondaryType)}
                            >
                                {secondaryLabel}
                            </button>
                        )}
                    </>
                );
            })()}

            {workoutType && <WorkoutScreen sessionType={workoutType} onClose={() => setWorkoutType(null)} />}

            <div className="cube-card">
                <div className="cube-stat">
                    <span>Стрик</span>
                    <span className="cube-stat-value">
                        {stats.current_streak} {stats.current_streak === 1 ? 'день' : stats.current_streak < 5 ? 'дня' : 'дней'}
                    </span>
                </div>
            </div>

            <div className="cube-funfact">
                Знаешь ли ты, что регулярные тренировки улучшают качество сна на 65%? Твоё тело скажет спасибо!
            </div>
        </>
    );
};

/* ---------- RESPONSIBLE ---------- */

const TIER_PLAYER_LIMITS: Record<string, number> = { standard: 1, premium: 2, elite: 3 };

const ResponsibleView: React.FC = () => {
    const ownAccessTier = useAuthStore((s) => s.ownAccessTier);
    const shopFreezeBalance = useAuthStore((s) => s.shopFreezeBalance);
    const giftFreezeBalance = useAuthStore((s) => s.giftFreezeBalance);
    const subscription = useAuthStore((s) => s.subscription);
    const subActive = subscription?.active ?? false;
    const [players, setPlayers] = useState<MyPlayer[]>([]);
    const [loading, setLoading] = useState(true);
    // 8d: тап по игроку открывает полноценную страницу (находка №9),
    // висячая плашка с ⋮-меню удалена — все действия живут на странице.
    const [openPlayer, setOpenPlayer] = useState<MyPlayer | null>(null);
    const [giftBalance, setGiftBalance] = useState(0);
    const [packs, setPacks] = useState(false);

    const fetchPlayers = useCallback(() => {
        getMyPlayers().then(setPlayers).catch(() => {});
    }, []);

    const fetchPool = useCallback(() => {
        getShelfCatalog().then((c) => setGiftBalance(c.gift_balance)).catch(() => {});
    }, []);

    useEffect(() => {
        fetchPlayers();
        setLoading(false);
    }, [fetchPlayers]);

    useEffect(() => {
        if (subActive) fetchPool();
    }, [subActive, fetchPool]);

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') { fetchPlayers(); fetchPool(); }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [fetchPlayers, fetchPool]);

    const slotLimit = TIER_PLAYER_LIMITS[ownAccessTier ?? 'standard'] ?? 1;
    const slotsUsed = players.length;
    const slotsLeft = slotLimit - slotsUsed;

    return (
        <>
            {/* Пул капель наставника + заморозки. Личный drops_balance в режиме
                Responsible не показываем (§8.6). */}
            <div className="mentor-pool-row">
                <div>
                    <div className="mentor-pool-value">💧 {giftBalance}</div>
                    <div className="mentor-pool-label">капли для подарков</div>
                </div>
                <div className="wallet-chip">
                    <span className="wallet-chip-label">❄️ {shopFreezeBalance + giftFreezeBalance}</span>
                </div>
                <button className="cube-btn-sm" disabled={!subActive}
                    onClick={(e) => { e.stopPropagation(); hapticImpact('light'); setPacks(true); }}>
                    Пополнить
                </button>
            </div>

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
                        const avatar = playerAvatarUrl(p);
                        return (
                            <div
                                className={rowClass}
                                key={p.id}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isActive) return;
                                    hapticImpact('light');
                                    setOpenPlayer(p);
                                }}
                                style={{ cursor: isActive ? 'pointer' : 'default' }}
                            >
                                <div className="cube-avatar">
                                    {avatar
                                        ? <img src={avatar} alt={name} />
                                        : name.charAt(0)}
                                </div>
                                <div className="cube-player-info">
                                    <div className="cube-player-name">{name}</div>
                                </div>
                                <div className="cube-player-actions">
                                    {p.pending_promises > 0 && (
                                        <span className="shelf-pending-badge">⏳ {p.pending_promises}</span>
                                    )}
                                    <span style={{ opacity: 0.4, marginLeft: 6 }}>›</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
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

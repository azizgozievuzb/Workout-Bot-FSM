import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import api from '../../api/client';
import { getMyStats } from '../../api/stats';
import { useCached, CACHE_KEYS } from '../../api/cache';
import type { PlayerStats } from '../../api/stats';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import { getPlayerShop, restoreStreak } from '../../api/shop';
import type { PlayerShopState } from '../../api/shop';
import { playerAvatarUrl } from '../../utils/playerAvatar';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import RoleTransition from '../shared/RoleTransition';
import MentorPlayerScreens from './MentorPlayerScreens';
import WorkoutScreen from '../workout/WorkoutScreen';
import { getSchedule, type ScheduleState } from '../../api/schedule';
import { PlayerScheduleSection } from '../schedule/scheduleBlocks';
import type { SessionType } from '../../api/workout';
import ConfirmSpendModal from '../shared/ConfirmSpendModal';
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

    /* S66: три запроса экрана переведены на общий кэш (api/cache.ts). Те же
       ключи читают Market (shop+schedule) и профиль (stats) — при свайпе данные
       уже в памяти, экран рисуется мгновенно и молча обновляется в фоне. */
    const { data: stats, loading, setData: setStats } =
        useCached<PlayerStats>(CACHE_KEYS.myStats, getMyStats);
    const { data: sched, setData: setSched } =
        useCached<ScheduleState>(CACHE_KEYS.schedule, getSchedule);
    // 8c: витрина-агрегат — restore-офер после слома стрика
    const { data: shop, setData: setShop } =
        useCached<PlayerShopState>(CACHE_KEYS.playerShop, getPlayerShop);

    const [restDayInFlight, setRestDayInFlight] = useState(false);
    const [restDayToast, setRestDayToast] = useState('');
    const [workoutType, setWorkoutType] = useState<SessionType | null>(null);
    const [restoreConfirm, setRestoreConfirm] = useState(false);
    const [restoreBusy, setRestoreBusy] = useState(false);
    const [restoreToast, setRestoreToast] = useState('');

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

            {/* S62-4: звание дублируем в шапку Action-куба. На профиль-экране
                оно под именем, но туда игрок попадает только удержанием куба —
                выкупленное звание не должно прятаться за скрытым жестом. */}
            {stats.player_title && (
                <div className="player-title-line player-title-line--cube">
                    🏅 {stats.player_title}
                </div>
            )}

            {/* 8c: restore-плашка — 72ч после слома стрика.
                П.7: подтверждение переехало в общее окно траты — свой
                inline-диалог здесь больше не нужен, форма у всех трат одна. */}
            {/* S67: пока стрик сломан и восстановление доступно, плашка висит
                ПОСТОЯННО (урок №13c: важное состояние живёт строкой, не
                транзиентом). Гаснет сама — по текущей механике restore: после
                восстановления (RPC чистит lost_streak_*) или по концу окна 72ч.
                При нехватке капель кнопки НЕТ, но цена названа (урок №13b:
                серверное «нельзя» имеет парную проекцию в UI). */}
            {shop?.restore && (() => {
                const price = shop.restore.price;
                const enough = shop.drops_balance >= price;
                return (
                    <div className="restore-plate">
                        💔 Стрик прервался (было {shop.restore.lost_streak_len}).
                        {enough ? (
                            <button
                                className="cube-btn-sm"
                                style={{ display: 'block' }}
                                onClick={(e) => { e.stopPropagation(); hapticImpact('light'); setRestoreConfirm(true); }}
                            >
                                Восстановить — {price} 💧
                            </button>
                        ) : (
                            <div className="restore-plate-note">
                                Восстановить стоит {price} 💧 — сейчас не хватает
                            </div>
                        )}
                    </div>
                );
            })()}
            {restoreConfirm && shop?.restore && (
                <ConfirmSpendModal
                    title="🔥 Восстановить стрик"
                    price={shop.restore.price}
                    balance={shop.drops_balance}
                    note={`Вернём ${shop.restore.lost_streak_len} дн. Окно восстановления одноразовое.`}
                    confirmLabel="Восстановить"
                    busy={restoreBusy}
                    onConfirm={() => { void doRestore(); }}
                    onCancel={() => setRestoreConfirm(false)}
                />
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
                /* S67: день вне плана — свободная тренировка (light без камеры,
                   без оценки и без наград). Правду говорит САМА кнопка: новых
                   строк и плашек не добавляем (решение юзера 02.09, урок №21).
                   `!!sched` обязателен: пока расписание не приехало, null здесь
                   значит «не знаем», а не «свободный день». */
                const isFreeDay = !!sched && todayType === null;
                const primaryType: SessionType = (todayType === 'light' || isFreeDay) ? 'light' : 'main';
                const primaryLabel = isFreeDay
                    ? 'Тренировка без оценки'
                    : primaryType === 'light' ? '☀️ Лёгкая зарядка' : 'Приступим';
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
                {/* S67: XP не спорит со стриком цифрой — идёт полосой до
                    следующего уровня. Шкала обнуляется на каждом уровне;
                    и уровень, и остаток считает бэк (округление одно на всех). */}
                {(() => {
                    const cost = stats.level_cost ?? 0;
                    if (cost <= 0) return null;
                    const inLevel = stats.xp_in_level ?? 0;
                    const pct = Math.max(0, Math.min(100, Math.round((inLevel / cost) * 100)));
                    return (
                        <div className="xp-level">
                            <div className="xp-level-row">
                                <span>Уровень {stats.level ?? 0}</span>
                                {/* Единица обязательна: без неё «0 / 625» — число ни о
                                    чём, а на экране итога рядом живёт «XP +42»
                                    (находка юзера на смоуке S67, 05.09). */}
                                <span className="xp-level-nums">{inLevel} / {cost} XP</span>
                            </div>
                            <div className="xp-level-rail">
                                <div className="xp-level-fill" style={{ width: `${pct}%` }} />
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* S64-3: расписание переехало сюда из скрытой сводки — неделя,
                заморозки, дни main с платной сменой и инфо про light. Стоит
                НИЖЕ кнопок запуска: первый экран Action остаётся про «начать». */}
            <PlayerScheduleSection
                sched={sched}
                setSched={setSched}
                lastClosedDay={stats.last_closed_day ?? null}
                freeFreezes={stats.free_freezes_left ?? 0}
                paidFreezes={stats.paid_freezes ?? 0}
                dropsBalance={shop?.drops_balance ?? stats.drops_balance}
                onSpent={() => { getPlayerShop().then(setShop).catch(() => {}); }}
            />
        </>
    );
};

/* ---------- RESPONSIBLE ---------- */

const TIER_PLAYER_LIMITS: Record<string, number> = { standard: 1, premium: 2, elite: 3 };

const ResponsibleView: React.FC = () => {
    const ownAccessTier = useAuthStore((s) => s.ownAccessTier);
    const subscription = useAuthStore((s) => s.subscription);
    const subActive = subscription?.active ?? false;
    const [players, setPlayers] = useState<MyPlayer[]>([]);
    const [loading, setLoading] = useState(true);
    // 8d.1 (П.1a): тап по игроку открывает полноэкранную страницу НАБЛЮДЕНИЯ.
    // Управление полкой ушло в Market — здесь только досье, дарение и дверь
    // на полку. Бейдж «⏳ N» тоже переехал в Market (Д1): одна роль на куб.
    const [openPlayer, setOpenPlayer] = useState<MyPlayer | null>(null);

    const fetchPlayers = useCallback(() => {
        getMyPlayers().then(setPlayers).catch(() => {});
    }, []);

    useEffect(() => {
        fetchPlayers();
        setLoading(false);
    }, [fetchPlayers]);

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') fetchPlayers();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [fetchPlayers]);

    const slotLimit = TIER_PLAYER_LIMITS[ownAccessTier ?? 'standard'] ?? 1;
    const slotsUsed = players.length;
    const slotsLeft = slotLimit - slotsUsed;

    return (
        <>
            {/* 8d.1 (П.1a): пул капель и «Пополнить» здесь БЫЛИ и убраны —
                их дом Market, одна роль на куб. Остатки 💧 и ❄️ наставник видит
                там, где они нужны: в окне дарения на странице игрока. */}
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
                                    <span style={{ opacity: 0.4, marginLeft: 6 }}>›</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {openPlayer && (
                <MentorPlayerScreens
                    playerId={openPlayer.id}
                    initial="profile"
                    onClose={() => { setOpenPlayer(null); fetchPlayers(); }}
                />
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

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import api from '../../api/client';
import { getMyPlayerCode } from '../../api/promo';
import type { AccessTier } from '../../api/promo';
import TierBadge from '../common/TierBadge';
import { getMyStats } from '../../api/stats';
import type { PlayerStats } from '../../api/stats';
import { getActiveBoost } from '../../api/boosts';
import { buyBoost } from '../../api/boosts';
import type { ActiveBoost } from '../../api/boosts';
import {
    createRenewalRequest,
    listMyRenewalRequests,
} from '../../api/renewal';
import type { RenewalRequest } from '../../api/renewal';
import { getMyPlayers } from '../../api/partnerships';
import type { MyPlayer } from '../../api/partnerships';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import RoleTransition from '../shared/RoleTransition';
import RenewalModal from './RenewalModal';
import BonusPackModal from './BonusPackModal';
import GiftFreezeModal from './GiftFreezeModal';
import TierChangeModal from './TierChangeModal';
import WorkoutScreen from '../workout/WorkoutScreen';
import TierMatrixScreen from '../shared/TierMatrixScreen';
import '../../styles/cubes.css';

const RENEWAL_PENDING_KEY = 'wb_renewal_pending_until';
const RENEWAL_PROMPT_THRESHOLD_DAYS = 7;

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
                    ? 'Введите промокод чтобы разблокировать'
                    : 'Вам нужна пригласительная ссылка'}
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
    const [requestPending, setRequestPending] = useState<boolean>(() => {
        const until = parseInt(localStorage.getItem(RENEWAL_PENDING_KEY) || '0', 10);
        return Number.isFinite(until) && until > Date.now();
    });
    const [cooldownError, setCooldownError] = useState<string>('');
    const [restDayInFlight, setRestDayInFlight] = useState(false);
    const [restDayToast, setRestDayToast] = useState('');
    const [workoutOpen, setWorkoutOpen] = useState(false);
    const [tierMatrixOpen, setTierMatrixOpen] = useState(false);

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

    const handleAskRenewal = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (requestPending) return;
        hapticImpact('medium');
        try {
            await createRenewalRequest();
            const until = Date.now() + 24 * 60 * 60 * 1000;
            localStorage.setItem(RENEWAL_PENDING_KEY, String(until));
            setRequestPending(true);
            setCooldownError('');
            hapticNotification('success');
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            if (err?.response?.status === 429) {
                const createdAt = typeof detail === 'object' ? detail?.created_at : null;
                if (createdAt) {
                    const until = new Date(createdAt).getTime() + 24 * 60 * 60 * 1000;
                    localStorage.setItem(RENEWAL_PENDING_KEY, String(until));
                    setRequestPending(true);
                }
                const msg = (typeof detail === 'object' && detail?.message)
                    || 'Вы уже отправили запрос. Попробуйте позже.';
                setCooldownError(msg);
                hapticNotification('warning');
            } else {
                setCooldownError('Не удалось отправить запрос.');
                hapticNotification('error');
            }
        }
    }, [requestPending]);

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

    const showRenewalPrompt = daysLeft !== null && daysLeft <= RENEWAL_PROMPT_THRESHOLD_DAYS;

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
            <button
                className="tier-matrix-link"
                onClick={(e) => { e.stopPropagation(); hapticImpact('light'); setTierMatrixOpen(true); }}
            >
                ℹ️ Тарифы
            </button>

            {tierMatrixOpen && <TierMatrixScreen onClose={() => setTierMatrixOpen(false)} />}

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

            {/* C. Renewal prompt */}
            {showRenewalPrompt && (
                <div className="renewal-prompt">
                    <p className="renewal-prompt__text">
                        До окончания доступа: {daysLeft} дн.
                    </p>
                    <button
                        className="renewal-prompt__btn"
                        onClick={handleAskRenewal}
                        disabled={requestPending}
                    >
                        {requestPending ? '✓ Запрос отправлен' : 'Попросить Ответственного продлить'}
                    </button>
                    {cooldownError && (
                        <p className="renewal-prompt__error">{cooldownError}</p>
                    )}
                </div>
            )}

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

interface PlayerCodeData {
    code: string | null;
    deep_link: string | null;
    is_used: boolean;
    duration_days?: number | null;
    expires_at?: string | null;
    days_left?: number | null;
    access_tier?: AccessTier | null;
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return 'только что';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ч назад`;
    const days = Math.floor(hrs / 24);
    return `${days} д назад`;
}

const TIER_PLAYER_LIMITS: Record<string, number> = { standard: 1, premium: 2, elite: 3 };

type ModalKind = 'renewal' | 'bonus' | 'gift' | 'tier';

const daysChipClass = (p: MyPlayer): string => {
    if (p.is_expired || p.is_deactivated) return 'days-chip days-chip--grey';
    const d = p.days_left ?? 0;
    if (d <= 7) return 'days-chip days-chip--red';
    if (d <= 14) return 'days-chip days-chip--yellow';
    return 'days-chip days-chip--green';
};

const ResponsibleView: React.FC = () => {
    const ownAccessTier = useAuthStore((s) => s.ownAccessTier);
    const shopFreezeBalance = useAuthStore((s) => s.shopFreezeBalance);
    const giftFreezeBalance = useAuthStore((s) => s.giftFreezeBalance);
    const [playerCodeData, setPlayerCodeData] = useState<PlayerCodeData | null>(null);
    const [players, setPlayers] = useState<MyPlayer[]>([]);
    const [requests, setRequests] = useState<RenewalRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState('');
    const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
    const [modal, setModal] = useState<{ kind: ModalKind; partnershipId?: string; targetUserId?: string; playerName?: string | null } | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const fetchCode = useCallback(() => {
        getMyPlayerCode()
            .then((data) => setPlayerCodeData(data))
            .catch(() => {});
    }, []);

    const fetchPlayers = useCallback(() => {
        getMyPlayers()
            .then(setPlayers)
            .catch(() => {});
    }, []);

    const fetchRequests = useCallback(() => {
        listMyRenewalRequests()
            .then(setRequests)
            .catch(() => {});
    }, []);

    useEffect(() => {
        fetchCode();
    }, [fetchCode]);

    useEffect(() => {
        Promise.all([
            getMyPlayers().then(setPlayers).catch(() => {}),
            listMyRenewalRequests().then(setRequests).catch(() => {}),
        ]).finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const tick = () => {
            if (document.visibilityState !== 'visible') return;
            fetchRequests();
        };
        const id = window.setInterval(tick, 60_000);
        document.addEventListener('visibilitychange', tick);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', tick);
        };
    }, [fetchRequests]);

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                fetchCode();
                fetchPlayers();
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [fetchCode, fetchPlayers]);

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

    const requestsByPlayer = useMemo(() => {
        const map: Record<string, RenewalRequest> = {};
        for (const r of requests) {
            const prev = map[r.player_id];
            if (!prev || r.created_at > prev.created_at) map[r.player_id] = r;
        }
        return map;
    }, [requests]);

    const copyCode = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!playerCodeData?.code) return;
        navigator.clipboard.writeText(playerCodeData.code);
        setToast('Скопировано!');
        setTimeout(() => setToast(''), 2000);
    }, [playerCodeData]);

    const handleBoost = useCallback(async (e: React.MouseEvent, playerId: string) => {
        e.stopPropagation();
        try {
            const res = await buyBoost(playerId);
            setToast(res.message);
        } catch (err: any) {
            setToast(err?.response?.data?.detail || 'Ошибка');
        }
        setTimeout(() => setToast(''), 3000);
    }, []);

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

    const handleRenewalSuccess = useCallback((addedDays: number) => {
        setModal(null);
        setToast(`Продлено на ${addedDays} дн.`);
        setTimeout(() => setToast(''), 3000);
        fetchPlayers();
        fetchRequests();
    }, [fetchPlayers, fetchRequests]);

    const handleBonusSuccess = useCallback((msg: string) => {
        setModal(null);
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    }, []);

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
                    <span className="wallet-chip-icon">🧊</span>
                    <span className="wallet-chip-label">Магазин</span>
                    <span className="wallet-chip-value">{shopFreezeBalance}</span>
                </div>
                <div className="wallet-chip">
                    <span className="wallet-chip-icon">🎁</span>
                    <span className="wallet-chip-label">Подарки</span>
                    <span className="wallet-chip-value">{giftFreezeBalance}</span>
                </div>
            </div>

            <div className="promo-invite-chip-row">
                {slotsLeft > 0 && playerCodeData && playerCodeData.code && !playerCodeData.is_used ? (
                    <>
                        <div
                            className="promo-invite-chip"
                            onClick={copyCode}
                            title="Нажмите, чтобы скопировать код"
                        >
                            <span className="promo-invite-chip-label">Код</span>
                            <span className="promo-invite-chip-code">{playerCodeData.code}</span>
                            <span className="promo-invite-chip-copy">📋</span>
                        </div>
                        {playerCodeData.access_tier && (
                            <TierBadge tier={playerCodeData.access_tier} />
                        )}
                    </>
                ) : slotsLeft <= 0 ? (
                    <div className="player-slots-full">Все слоты заняты</div>
                ) : (
                    <button
                        className="promo-generate-btn"
                        onClick={(e) => { e.stopPropagation(); fetchCode(); }}
                    >
                        Обновить
                    </button>
                )}
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
                    <div className="cube-locked-text">Нет активных игроков. Выдайте промокод или пригласите нового.</div>
                </div>
            ) : (
                <div className="cube-card">
                    {players.map(p => {
                        const req = requestsByPlayer[p.id];
                        const rowClass = [
                            'player-row',
                            req ? 'player-row--has-request' : '',
                            (p.is_expired || p.is_deactivated) ? 'player-row--deactivated' : '',
                        ].filter(Boolean).join(' ');
                        const name = p.first_name || '—';
                        const isExpired = p.is_expired || p.is_deactivated;
                        const daysLabel = isExpired
                            ? 'Истёк'
                            : p.days_left !== null
                                ? `${p.days_left} дн.`
                                : '—';
                        return (
                            <div className={rowClass} key={p.id}>
                                <div className="cube-avatar">
                                    {p.profile_photo_url
                                        ? <img src={p.profile_photo_url} alt={name} />
                                        : name.charAt(0)}
                                </div>
                                <div className="cube-player-info">
                                    <div className="cube-player-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {name}
                                        <TierBadge tier={p.access_tier} />
                                    </div>
                                    <div className="cube-player-meta">
                                        <span className={daysChipClass(p)}>{daysLabel}</span>
                                    </div>
                                    {req && (
                                        <div className="player-row__request">
                                            🔔 Просит продлить ({relativeTime(req.created_at)})
                                        </div>
                                    )}
                                </div>
                                <div className="cube-player-actions" style={{ position: 'relative' }}>
                                    {!isExpired && (
                                        <button className="cube-btn-sm" onClick={(e) => handleBoost(e, p.id)}>
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
                                                onClick={(e) => { e.stopPropagation(); openModal('renewal', p); }}
                                            >
                                                Продлить
                                            </button>
                                            <button
                                                className="player-context-menu-item"
                                                onClick={(e) => { e.stopPropagation(); openModal('bonus', p); }}
                                            >
                                                Бонус-пак
                                            </button>
                                            <button
                                                className="player-context-menu-item"
                                                onClick={(e) => { e.stopPropagation(); openModal('gift', p); }}
                                            >
                                                Подарить заморозку
                                            </button>
                                            <button
                                                className="player-context-menu-item"
                                                onClick={(e) => { e.stopPropagation(); openModal('tier', p); }}
                                            >
                                                Сменить тир
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {modal?.kind === 'renewal' && modal.partnershipId && (
                <RenewalModal
                    partnershipId={modal.partnershipId}
                    playerName={modal.playerName ?? null}
                    onClose={closeModal}
                    onSuccess={handleRenewalSuccess}
                />
            )}
            {modal?.kind === 'bonus' && (
                <BonusPackModal
                    onClose={closeModal}
                    onSuccess={handleBonusSuccess}
                />
            )}
            {modal?.kind === 'gift' && modal.targetUserId && (
                <GiftFreezeModal
                    targetUserId={modal.targetUserId}
                    playerName={modal.playerName ?? null}
                    onClose={closeModal}
                    onSuccess={handleGiftSuccess}
                />
            )}
            {modal?.kind === 'tier' && (
                <TierChangeModal onClose={closeModal} />
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

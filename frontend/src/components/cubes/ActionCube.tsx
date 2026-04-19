import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { getMyPlayerCode, getPlayerStatus } from '../../api/promo';
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
    listMyPlayers,
} from '../../api/renewal';
import type { RenewalRequest, MyPlayer } from '../../api/renewal';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import RoleTransition from '../shared/RoleTransition';
import RenewalModal from '../renewal/RenewalModal';
import WorkoutScreen from '../workout/WorkoutScreen';
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

interface PlayerStatus {
    is_active: boolean;
    expires_at: string | null;
    days_left: number | null;
    duration_days: number | null;
}

const PlayerView: React.FC = () => {
    const [stats, setStats] = useState<PlayerStats | null>(null);
    const [boost, setBoost] = useState<ActiveBoost | null>(null);
    const [promoStatus, setPromoStatus] = useState<PlayerStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [requestPending, setRequestPending] = useState<boolean>(() => {
        const until = parseInt(localStorage.getItem(RENEWAL_PENDING_KEY) || '0', 10);
        return Number.isFinite(until) && until > Date.now();
    });
    const [cooldownError, setCooldownError] = useState<string>('');
    const [workoutOpen, setWorkoutOpen] = useState(false);

    const handleStartWorkout = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        hapticImpact('medium');
        setWorkoutOpen(true);
    }, []);

    useEffect(() => {
        let done = 0;
        const check = () => { if (++done >= 3) setLoading(false); };
        getMyStats().then(setStats).catch(() => {}).finally(check);
        getActiveBoost().then(setBoost).catch(() => {}).finally(check);
        getPlayerStatus().then(setPromoStatus).catch(() => {}).finally(check);
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

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;
    if (!stats) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Не удалось загрузить</div>;

    const daysLeft = promoStatus?.days_left ?? null;
    const showExpiryBanner = promoStatus?.is_active === true && daysLeft !== null && daysLeft <= 1;
    const showRenewalPrompt =
        promoStatus?.is_active === true
        && daysLeft !== null
        && daysLeft <= RENEWAL_PROMPT_THRESHOLD_DAYS;

    return (
        <>
            {showExpiryBanner && (
                <div className="player-expiry-banner">
                    ⚠️ Доступ истекает через {daysLeft === 0 ? 'менее суток' : `${daysLeft} д.`}
                </div>
            )}

            {promoStatus?.expires_at && (
                <div className="promo-invite-chip-row" style={{ justifyContent: 'flex-end' }}>
                    <div className="promo-invite-chip" title="Срок действия доступа">
                        <span className="promo-invite-chip-label">До</span>
                        <span className="promo-invite-chip-code">
                            {new Date(promoStatus.expires_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                        </span>
                    </div>
                </div>
            )}

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

            {stats.rest_days_remaining > 0 && (
                <button className="cube-rest-btn" onClick={(e) => e.stopPropagation()}>
                    День отдыха (осталось {stats.rest_days_remaining}/3)
                </button>
            )}
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

const ResponsibleView: React.FC = () => {
    const { accessTier } = useAuthStore();
    const [playerCodeData, setPlayerCodeData] = useState<PlayerCodeData | null>(null);
    const [players, setPlayers] = useState<MyPlayer[]>([]);
    const [requests, setRequests] = useState<RenewalRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState('');
    const [renewalModalPlayerId, setRenewalModalPlayerId] = useState<string | null>(null);

    const fetchCode = useCallback(() => {
        getMyPlayerCode()
            .then((data) => setPlayerCodeData(data))
            .catch(() => {});
    }, []);

    const fetchPlayers = useCallback(() => {
        listMyPlayers()
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
            listMyPlayers().then(setPlayers).catch(() => {}),
            listMyRenewalRequests().then(setRequests).catch(() => {}),
        ]).finally(() => setLoading(false));
    }, []);

    // Polling renewal-requests every 60s + on visibility
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
        const onVisible = () => { if (document.visibilityState === 'visible') fetchCode(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [fetchCode]);

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

    const openRenewalModal = useCallback((e: React.MouseEvent, playerId: string) => {
        e.stopPropagation();
        hapticImpact('light');
        setRenewalModalPlayerId(playerId);
    }, []);

    const handleRenewalSuccess = useCallback((addedDays: number) => {
        setRenewalModalPlayerId(null);
        setToast(`Продлено на ${addedDays} дн.`);
        setTimeout(() => setToast(''), 3000);
        fetchPlayers();
        fetchRequests();
    }, [fetchPlayers, fetchRequests]);

    const selectedPlayer = players.find(p => p.id === renewalModalPlayerId) || null;
    const slotLimit = TIER_PLAYER_LIMITS[accessTier] ?? 1;
    const slotsUsed = players.length;
    const slotsLeft = slotLimit - slotsUsed;

    return (
        <>
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
                            p.is_deactivated ? 'player-row--deactivated' : '',
                        ].filter(Boolean).join(' ');
                        const name = p.first_name || '—';
                        return (
                            <div className={rowClass} key={p.id}>
                                <div className="cube-avatar">{name.charAt(0)}</div>
                                <div className="cube-player-info">
                                    <div className="cube-player-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {name}
                                        <TierBadge tier={p.access_tier} />
                                        {p.is_deactivated && (
                                            <span className="cube-player-badge-expired">Истёк</span>
                                        )}
                                    </div>
                                    <div className="cube-player-meta">
                                        {p.is_deactivated
                                            ? 'Доступ неактивен'
                                            : p.days_left !== null
                                                ? `${p.days_left} дн. осталось`
                                                : 'Срок не задан'}
                                    </div>
                                    {req && (
                                        <div className="player-row__request">
                                            🔔 Просит продлить ({relativeTime(req.created_at)})
                                        </div>
                                    )}
                                </div>
                                <div className="cube-player-actions">
                                    {!p.is_deactivated && (
                                        <button className="cube-btn-sm" onClick={(e) => handleBoost(e, p.id)}>
                                            ⚡X2
                                        </button>
                                    )}
                                    <button
                                        className="cube-btn-sm accent"
                                        onClick={(e) => openRenewalModal(e, p.id)}
                                    >
                                        Продлить
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {renewalModalPlayerId && (
                <RenewalModal
                    playerId={renewalModalPlayerId}
                    playerName={selectedPlayer?.first_name ?? null}
                    onClose={() => setRenewalModalPlayerId(null)}
                    onSuccess={handleRenewalSuccess}
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

import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { DualRoleUser } from '../../stores/authStore';
import { canPlay, canMonitor, isDualRole } from '../../utils/roles';
import { getMyPlayerCode } from '../../api/promo';
import { getMyStats } from '../../api/stats';
import { getPartnerStats } from '../../api/stats';
import type { PlayerStats, PartnerStats } from '../../api/stats';
import { getActiveBoost } from '../../api/boosts';
import { buyBoost } from '../../api/boosts';
import type { ActiveBoost } from '../../api/boosts';
import RoleTransition from '../shared/RoleTransition';
import '../../styles/cubes.css';

type ActiveView = 'player' | 'responsible';

const ActionCube: React.FC = () => {
    const { primary_role, has_player_access, has_responsible_access, is_admin } = useAuthStore();
    const user: DualRoleUser = {
        primary_role: primary_role || 'player',
        has_player_access,
        has_responsible_access,
        is_admin,
    };

    const [view, setView] = useState<ActiveView>(canPlay(user) ? 'player' : 'responsible');
    const dual = isDualRole(user);

    const toggleView = () => setView(v => v === 'player' ? 'responsible' : 'player');

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

const PlayerView: React.FC = () => {
    const [stats, setStats] = useState<PlayerStats | null>(null);
    const [boost, setBoost] = useState<ActiveBoost | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let done = 0;
        const check = () => { if (++done >= 2) setLoading(false); };
        getMyStats()
            .then(setStats)
            .catch((err) => {
                console.error('[ActionCube] getMyStats FAILED:', err?.response?.status, err?.response?.data, err?.message);
            })
            .finally(check);
        getActiveBoost()
            .then(setBoost)
            .catch((err) => {
                console.error('[ActionCube] getActiveBoost FAILED:', err?.response?.status, err?.response?.data, err?.message);
            })
            .finally(check);
    }, []);

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;
    if (!stats) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Не удалось загрузить</div>;

    return (
        <>
            <button className="cube-btn-primary" onClick={(e) => e.stopPropagation()}>
                Приступим
            </button>

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
}

const ResponsibleView: React.FC = () => {
    const [playerCodeData, setPlayerCodeData] = useState<PlayerCodeData | null>(null);
    const [players, setPlayers] = useState<PartnerStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState('');

    useEffect(() => {
        getMyPlayerCode()
            .then((data) => setPlayerCodeData(data))
            .catch(() => {});
    }, []);

    useEffect(() => {
        getPartnerStats()
            .then(setPlayers)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const copyCode = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!playerCodeData?.code) return;
        navigator.clipboard.writeText(playerCodeData.code);
        setToast('Скопировано!');
        setTimeout(() => setToast(''), 2000);
    }, [playerCodeData]);

    const copyLink = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!playerCodeData?.deep_link) return;
        navigator.clipboard.writeText(playerCodeData.deep_link);
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

    return (
        <>
            {playerCodeData && playerCodeData.code && !playerCodeData.is_used && (
                <div className="promo-invite-block">
                    <div className="promo-invite-label">Пригласите игрока</div>
                    <div className="promo-invite-code">{playerCodeData.code}</div>
                    <div className="promo-invite-actions">
                        <button className="cube-btn-sm" onClick={copyCode}>
                            📋 Скопировать код
                        </button>
                        <button className="cube-btn-sm" onClick={copyLink}>
                            🔗 Скопировать ссылку
                        </button>
                    </div>
                </div>
            )}

            {toast && <div className="admin-toast">{toast}</div>}

            <div className="cube-section-title">Ваши игроки</div>

            {loading ? (
                <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>
            ) : players.length === 0 ? (
                <div className="cube-locked">
                    <div className="cube-locked-text">Нет привязанных игроков</div>
                </div>
            ) : (
                <div className="cube-card">
                    {players.map(p => (
                        <div className="cube-player-row" key={p.player_id}>
                            <div className="cube-avatar">{p.first_name.charAt(0)}</div>
                            <div className="cube-player-info">
                                <div className="cube-player-name">{p.first_name}</div>
                                <div className="cube-player-meta">
                                    Стрик: {p.current_streak} · {p.last_workout_date || 'Нет тренировок'}
                                </div>
                            </div>
                            <div className="cube-player-actions">
                                <button className="cube-btn-sm" onClick={(e) => e.stopPropagation()}>
                                    Пинг
                                </button>
                                <button className="cube-btn-sm" onClick={(e) => handleBoost(e, p.player_id)}>
                                    ⚡X2
                                </button>
                            </div>
                        </div>
                    ))}
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

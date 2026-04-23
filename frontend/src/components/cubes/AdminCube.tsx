import React, { useState, useCallback, useEffect, useRef } from 'react';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import {
    listPromoCodes, getConnections, toggleMaintenance, unbanUser,
    getMaintenanceStatus, getBanHistory,
} from '../../api/admin';
import type { MaintenanceStatus, ResponsibleGroup, BanHistoryEntry } from '../../api/admin';
import { createResponsibleCode, createRenewalCode } from '../../api/promo';
import type { AccessTier, DurationDays } from '../../api/promo';
import type { PromoCodeInfo } from '../../api/admin';
import TierBadge from '../common/TierBadge';
import BanUserModal from '../shared/BanUserModal';
import BuyCodesModal from '../shared/BuyCodesModal';
import '../../styles/cubes.css';

type AdminTab = 'promos' | 'connections' | 'settings' | 'bans';
type GeneratorMode = 'responsible' | 'renewal';

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

const fmt = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
};

const SettingsPanel: React.FC = () => {
    const [status, setStatus] = useState<MaintenanceStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(false);
    const [frozenSecs, setFrozenSecs] = useState(0);
    const [toast, setToast] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const s = await getMaintenanceStatus();
            setStatus(s);
            if (s.maintenance_mode && s.frozen_seconds != null) {
                setFrozenSecs(s.frozen_seconds);
            }
        } catch { /* ignore */ } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
        const poll = setInterval(fetchStatus, 30_000);
        return () => clearInterval(poll);
    }, [fetchStatus]);

    useEffect(() => {
        if (status?.maintenance_mode) {
            tickRef.current = setInterval(() => setFrozenSecs(s => s + 1), 1000);
        } else {
            if (tickRef.current) clearInterval(tickRef.current);
        }
        return () => { if (tickRef.current) clearInterval(tickRef.current); };
    }, [status?.maintenance_mode]);

    const doToggle = useCallback(async () => {
        setConfirmOpen(false);
        setToggling(true);
        try {
            const res = await toggleMaintenance();
            if (res.maintenance_mode) {
                hapticNotification('warning');
                setFrozenSecs(0);
            } else {
                hapticNotification('success');
                const mins = Math.round((res.frozen_seconds ?? 0) / 60);
                setToast(`Время продлено на ${mins} мин.`);
                setTimeout(() => setToast(''), 3000);
                setFrozenSecs(0);
            }
            await fetchStatus();
        } catch {
            setToast('Ошибка');
            setTimeout(() => setToast(''), 2000);
        }
        setToggling(false);
    }, [fetchStatus]);

    const handleToggleTap = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!status?.maintenance_mode) {
            setConfirmOpen(true);
        } else {
            doToggle();
        }
    };

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;

    return (
        <div className="settings-panel">
            <div className="cube-card">
                <div className="settings-row">
                    <div className="settings-row-info">
                        <div className="cube-player-name">Режим тех. работ</div>
                        <div className="cube-player-meta">Все пользователи увидят экран блокировки</div>
                    </div>
                    <button
                        className={`toggle-switch${status?.maintenance_mode ? ' on' : ''}`}
                        onClick={handleToggleTap}
                        disabled={toggling}
                        aria-label="Переключить"
                    />
                </div>
                {status?.maintenance_mode && (
                    <div className="frozen-timer">Заморожено: {fmt(frozenSecs)}</div>
                )}
            </div>

            {confirmOpen && (
                <div className="settings-confirm" onClick={(e) => e.stopPropagation()}>
                    <div className="settings-confirm-text">
                        Все пользователи увидят экран тех. работ. Продолжить?
                    </div>
                    <div className="settings-confirm-btns">
                        <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); setConfirmOpen(false); }}>
                            Отмена
                        </button>
                        <button className="cube-btn-sm" style={{ background: 'rgba(231,76,60,0.2)', color: '#e74c3c' }}
                            onClick={(e) => { e.stopPropagation(); doToggle(); }}>
                            Включить
                        </button>
                    </div>
                </div>
            )}

            {toast && <div className="admin-toast">{toast}</div>}
        </div>
    );
};

// ---------------------------------------------------------------------------
// CompletionBar
// ---------------------------------------------------------------------------

const CompletionBar: React.FC<{ rate: number }> = ({ rate }) => (
    <div className="completion-bar-wrap">
        <div className="completion-bar">
            <div className="completion-bar-fill" style={{ width: `${Math.round(rate * 100)}%` }} />
        </div>
        <span className="completion-bar-pct">{Math.round(rate * 100)}%</span>
    </div>
);

// ---------------------------------------------------------------------------
// ConnectionsPanel
// ---------------------------------------------------------------------------

type ConnView = 'cards' | 'table';

const ConnectionsPanel: React.FC = () => {
    const [groups, setGroups] = useState<ResponsibleGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [menuFor, setMenuFor] = useState<string | null>(null);
    const [banModal, setBanModal] = useState<{ id: string; name: string } | null>(null);
    const [view, setView] = useState<ConnView>('cards');
    const [expandedR, setExpandedR] = useState<Set<number>>(new Set());

    const reload = useCallback(() => {
        setLoading(true);
        getConnections().then(d => setGroups(d.groups)).catch(() => {}).finally(() => setLoading(false));
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const handleUnban = useCallback(async (playerId: string) => {
        setMenuFor(null);
        try {
            await unbanUser(playerId);
            hapticNotification('success');
            reload();
        } catch { /* ignore */ }
    }, [reload]);

    const formatBanUntil = (until: string | null) => {
        if (!until) return '';
        const d = new Date(until);
        return `до ${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    };

    const toggleExpand = (tgId: number) => {
        hapticImpact('light');
        setExpandedR(prev => {
            const s = new Set(prev);
            if (s.has(tgId)) s.delete(tgId); else s.add(tgId);
            return s;
        });
    };

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;
    if (!groups.length) return <div className="cube-locked"><div className="cube-locked-text">Нет зарегистрированных пользователей</div></div>;

    return (
        <>
            <div className="connections-view-switcher">
                <button className={`connections-view-btn${view === 'cards' ? ' active' : ''}`} onClick={(e) => { e.stopPropagation(); setView('cards'); hapticImpact('light'); }}>Карточки</button>
                <button className={`connections-view-btn${view === 'table' ? ' active' : ''}`} onClick={(e) => { e.stopPropagation(); setView('table'); hapticImpact('light'); }}>Таблица</button>
            </div>

            {view === 'cards' ? (
                <div className="cube-card">
                    {groups.map(g => (
                        <div key={g.telegram_id} className="connections-group">
                            <div className="connections-responsible">
                                <div className="cube-avatar" style={{ background: 'var(--tg-theme-button-color, #6c5ce7)' }}>R</div>
                                <div className="cube-player-info">
                                    <div className="cube-player-name">{g.display_name || g.username || `#${g.telegram_id}`}</div>
                                    <div className="cube-player-meta">
                                        {g.players.length} игр{g.players.length === 1 ? 'рок' : g.players.length < 5 ? 'рока' : 'роков'}
                                        {g.stats && ` · ${g.stats.active_players} акт. · ⭐${g.stats.total_stars_earned}`}
                                    </div>
                                </div>
                            </div>
                            {g.players.length === 0 ? (
                                <div className="connections-empty">нет игроков</div>
                            ) : (
                                g.players.map(p => {
                                    const name = p.display_name || p.username || `#${p.telegram_id}`;
                                    const showMenu = menuFor === p.id;
                                    return (
                                        <div
                                            key={p.telegram_id}
                                            className={`cube-player-row connections-player${p.is_deactivated || p.is_banned ? ' deactivated' : ''}`}
                                            style={{ opacity: p.is_banned ? 0.4 : p.is_deactivated ? 0.45 : 1 }}
                                        >
                                            <div className="cube-avatar" style={{ fontSize: 12 }}>
                                                {p.is_banned ? '🚫' : 'P'}
                                            </div>
                                            <div className="cube-player-info">
                                                <div className="cube-player-name">{name}</div>
                                                {p.is_banned && (
                                                    <div className="cube-player-meta" style={{ color: 'var(--tg-theme-destructive-text-color, #e74c3c)' }}>
                                                        бан {formatBanUntil(p.ban_until)}
                                                    </div>
                                                )}
                                                {!p.is_banned && p.is_deactivated && (
                                                    <div className="cube-player-meta" style={{ color: 'var(--tg-theme-destructive-text-color, #e74c3c)' }}>
                                                        доступ истёк
                                                    </div>
                                                )}
                                                {p.stats && !p.is_banned && !p.is_deactivated && (
                                                    <CompletionBar rate={p.stats.completion_rate} />
                                                )}
                                            </div>
                                            <div className="cube-player-actions">
                                                <div style={{ position: 'relative' }}>
                                                    <button
                                                        className="cube-btn-sm player-menu-btn"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            hapticImpact('light');
                                                            setMenuFor(showMenu ? null : p.id);
                                                        }}
                                                    >⋮</button>
                                                    {showMenu && (
                                                        <div className="player-context-menu" onClick={(e) => e.stopPropagation()}>
                                                            {p.is_banned ? (
                                                                <button className="player-context-menu-item" onClick={() => handleUnban(p.id)}>
                                                                    Разбанить
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    className="player-context-menu-item destructive"
                                                                    onClick={() => { setMenuFor(null); setBanModal({ id: p.id, name }); }}
                                                                >
                                                                    Забанить
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="connections-table-wrap cube-card" style={{ padding: 0 }}>
                    <table className="connections-table">
                        <thead>
                            <tr>
                                <th>R / P</th>
                                <th>Игроки</th>
                                <th>Трен.</th>
                                <th>Актив.</th>
                                <th>⭐</th>
                                <th>Avg %</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {groups.map(g => {
                                const rName = g.display_name || g.username || `#${g.telegram_id}`;
                                const expanded = expandedR.has(g.telegram_id);
                                const s = g.stats;
                                return (
                                    <React.Fragment key={g.telegram_id}>
                                        <tr className="r-row" onClick={() => toggleExpand(g.telegram_id)}>
                                            <td className="r-row-name">
                                                <i className={`connections-expand-icon${expanded ? ' open' : ''}`}>▶</i>
                                                {' '}{rName}
                                            </td>
                                            <td>{g.players.length}</td>
                                            <td>{s?.total_workouts ?? '—'}</td>
                                            <td>{s?.active_players ?? '—'}</td>
                                            <td>{s?.total_stars_earned ?? '—'}</td>
                                            <td>{s ? <CompletionBar rate={s.avg_completion_rate} /> : '—'}</td>
                                            <td></td>
                                        </tr>
                                        {expanded && g.players.map(p => {
                                            const pName = p.display_name || p.username || `#${p.telegram_id}`;
                                            const lastRaw = p.stats?.last_workout_at;
                                            const lastFmt = lastRaw ? new Date(lastRaw).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—';
                                            return (
                                                <tr key={p.id} className="p-row">
                                                    <td>{p.is_banned ? '🚫 ' : ''}{pName}</td>
                                                    <td>{p.stats?.workouts_done ?? 0}</td>
                                                    <td></td>
                                                    <td>⭐{p.stats?.stars_balance ?? 0}</td>
                                                    <td>{lastFmt}</td>
                                                    <td>{p.stats ? <CompletionBar rate={p.stats.completion_rate} /> : '—'}</td>
                                                    <td style={{ position: 'relative' }}>
                                                        <button
                                                            className="cube-btn-sm player-menu-btn"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                hapticImpact('light');
                                                                setMenuFor(menuFor === p.id ? null : p.id);
                                                            }}
                                                        >⋮</button>
                                                        {menuFor === p.id && (
                                                            <div className="player-context-menu" onClick={(e) => e.stopPropagation()}>
                                                                {p.is_banned ? (
                                                                    <button className="player-context-menu-item" onClick={() => handleUnban(p.id)}>Разбанить</button>
                                                                ) : (
                                                                    <button className="player-context-menu-item destructive" onClick={() => { setMenuFor(null); setBanModal({ id: p.id, name: pName }); }}>Забанить</button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {banModal && (
                <BanUserModal
                    userId={banModal.id}
                    userName={banModal.name}
                    onClose={() => setBanModal(null)}
                    onSuccess={reload}
                />
            )}
        </>
    );
};

// ---------------------------------------------------------------------------
// BanHistoryPanel
// ---------------------------------------------------------------------------

type BanFilter = 'all' | 'active' | 'expired' | 'lifted';

const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
};

const BanHistoryPanel: React.FC = () => {
    const [bans, setBans] = useState<BanHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<BanFilter>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [unbanning, setUnbanning] = useState<string | null>(null);

    const reload = useCallback(() => {
        setLoading(true);
        getBanHistory().then(d => setBans(d.bans)).catch(() => {}).finally(() => setLoading(false));
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const handleUnban = useCallback(async (entry: BanHistoryEntry, e: React.MouseEvent) => {
        e.stopPropagation();
        setUnbanning(entry.id);
        try {
            await unbanUser(entry.user_id);
            hapticNotification('success');
            reload();
        } catch {
            hapticNotification('error');
        } finally {
            setUnbanning(null);
        }
    }, [reload]);

    const filtered = bans.filter(b => {
        if (filter === 'active') return b.is_active;
        if (filter === 'expired') return !b.is_active && !b.unbanned_early;
        if (filter === 'lifted') return b.unbanned_early;
        return true;
    });

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;

    return (
        <>
            <div className="ban-history-filter">
                {(['all', 'active', 'expired', 'lifted'] as BanFilter[]).map(f => (
                    <button
                        key={f}
                        className={`ban-filter-btn${filter === f ? ' active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setFilter(f); hapticImpact('light'); }}
                    >
                        {f === 'all' ? 'Все' : f === 'active' ? '🔴 Активен' : f === 'expired' ? '⚪ Истёк' : '🟢 Снят'}
                    </button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <div className="cube-locked"><div className="cube-locked-text">Нет записей</div></div>
            ) : (
                <div className="ban-history-list">
                    {filtered.map(b => {
                        const name = b.display_name || `#${b.telegram_id}`;
                        const expanded = expandedId === b.id;
                        const badge = b.unbanned_early
                            ? <span className="ban-status-badge ban-status-badge--lifted">🟢 Снят досрочно</span>
                            : b.is_active
                                ? <span className="ban-status-badge ban-status-badge--active">🔴 Активен</span>
                                : <span className="ban-status-badge ban-status-badge--expired">⚪ Истёк</span>;
                        return (
                            <div
                                key={b.id}
                                className={`ban-history-item${expanded ? ' expanded' : ''}`}
                                onClick={(e) => { e.stopPropagation(); setExpandedId(expanded ? null : b.id); hapticImpact('light'); }}
                            >
                                <div className="ban-history-row">
                                    <span className="ban-history-name">{name}</span>
                                    {badge}
                                    <span className="ban-history-date">{fmtDate(b.banned_at)}</span>
                                </div>
                                {expanded && (
                                    <>
                                        <div className="ban-history-detail">
                                            <div className="ban-history-reason">«{b.reason}»</div>
                                            <div className="ban-history-meta">
                                                Пропущено: {b.missed_workouts} · Бан до {fmtDate(b.ban_until)}
                                            </div>
                                        </div>
                                        {b.is_active && (
                                            <button
                                                className="ban-history-unban-btn"
                                                disabled={unbanning === b.id}
                                                onClick={(e) => handleUnban(b, e)}
                                            >
                                                {unbanning === b.id ? 'Снимаем...' : 'Разбанить'}
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
};

// ---------------------------------------------------------------------------
// CodeGeneratorPanel
// ---------------------------------------------------------------------------

const TIER_OPTIONS: AccessTier[] = ['standard', 'premium', 'elite'];
const TIER_LABELS: Record<AccessTier, string> = {
    standard: 'Standard',
    premium: 'Premium',
    elite: 'Elite VIP',
};
const DURATION_OPTIONS: DurationDays[] = [7, 30, 90, 180];

const CodeGeneratorPanel: React.FC = () => {
    const [mode, setMode] = useState<GeneratorMode>('responsible');
    const [tier, setTier] = useState<AccessTier>('standard');
    const [duration, setDuration] = useState<DurationDays>(30);
    const [generating, setGenerating] = useState(false);
    const [generatedCode, setGeneratedCode] = useState<string | null>(null);
    const [toast, setToast] = useState('');

    const handleGenerate = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        setGenerating(true);
        try {
            let code: string;
            if (mode === 'responsible') {
                const res = await createResponsibleCode(tier, duration);
                code = res.code;
            } else {
                const res = await createRenewalCode(tier, duration);
                code = res.code;
            }
            setGeneratedCode(code);
            hapticImpact('medium');
        } catch {
            setToast('Ошибка создания кода');
            setTimeout(() => setToast(''), 2500);
        } finally {
            setGenerating(false);
        }
    }, [mode, tier, duration]);

    const copyToClipboard = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!generatedCode) return;
        navigator.clipboard.writeText(generatedCode);
        hapticImpact('light');
        setToast('Скопировано!');
        setTimeout(() => setToast(''), 2000);
    }, [generatedCode]);

    return (
        <div className="admin-generator-form">
            <div className="tab-selector">
                <button
                    className={`tab-selector-btn${mode === 'responsible' ? ' active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setMode('responsible'); setGeneratedCode(null); hapticImpact('light'); }}
                >
                    R-код
                </button>
                <button
                    className={`tab-selector-btn${mode === 'renewal' ? ' active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setMode('renewal'); setGeneratedCode(null); hapticImpact('light'); }}
                >
                    Renewal-код
                </button>
            </div>
            <div className="admin-generator-hint">
                {mode === 'responsible' ? 'Новый Ответственный' : 'Продление для Игрока'}
            </div>
            {mode === 'responsible' && (
                <select
                    className="admin-generator-select"
                    value={tier}
                    onChange={(e) => { e.stopPropagation(); setTier(e.target.value as AccessTier); }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {TIER_OPTIONS.map(t => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
                </select>
            )}
            <select
                className="admin-generator-select"
                value={duration}
                onChange={(e) => { e.stopPropagation(); setDuration(Number(e.target.value) as DurationDays); }}
                onClick={(e) => e.stopPropagation()}
            >
                {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} дней</option>)}
            </select>
            <button className="cube-btn-primary" onClick={handleGenerate} disabled={generating}>
                {generating ? 'Создаём...' : 'Создать код'}
            </button>
            {generatedCode && (
                <div className="code-display">
                    <code className="code-display-text">{generatedCode}</code>
                    <button className="cube-btn-sm" onClick={copyToClipboard}>📋</button>
                    {mode === 'responsible' && <TierBadge tier={tier} />}
                    <span className="code-display-meta">{duration} дн.</span>
                </div>
            )}
            {toast && <div className="admin-toast">{toast}</div>}
        </div>
    );
};

// ---------------------------------------------------------------------------
// PromoListPanel
// ---------------------------------------------------------------------------

const PromoListPanel: React.FC = () => {
    const [codes, setCodes] = useState<PromoCodeInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [filterUsed, setFilterUsed] = useState<boolean | undefined>(undefined);

    const fetchCodes = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listPromoCodes(filterUsed !== undefined ? { is_used: filterUsed } : undefined);
            setCodes(data.codes);
        } catch { /* ignore */ }
        setLoading(false);
    }, [filterUsed]);

    useEffect(() => { fetchCodes(); }, [fetchCodes]);

    return (
        <>
            <div className="cube-tabs">
                {([undefined, false, true] as (boolean | undefined)[]).map((v, i) => (
                    <button
                        key={i}
                        className={`cube-tab${filterUsed === v ? ' active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setFilterUsed(v); }}
                    >
                        {v === undefined ? 'Все' : v === false ? 'Свободные' : 'Использованные'}
                    </button>
                ))}
            </div>
            {loading ? (
                <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>
            ) : codes.length === 0 ? (
                <div className="cube-locked"><div className="cube-locked-text">Промокодов пока нет</div></div>
            ) : (
                <div className="cube-card">
                    {codes.map(c => (
                        <div className="cube-player-row" key={c.id}>
                            <div className="cube-avatar" style={{ fontSize: 14, fontFamily: 'monospace' }}>
                                {c.code_type === 'responsible' ? 'R' : c.code_type === 'player' ? 'P' : 'A'}
                            </div>
                            <div className="cube-player-info">
                                <div className="cube-player-name" style={{ fontFamily: 'monospace', letterSpacing: 1 }}>{c.code}</div>
                                <div className="cube-player-meta">
                                    {c.tier} · {c.is_used ? 'Использован' : 'Свободен'}
                                    {c.created_at && ` · ${new Date(c.created_at).toLocaleDateString()}`}
                                </div>
                            </div>
                            <div className="cube-player-actions">
                                {!c.is_used && (
                                    <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(c.code); }}>📋</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
};

// ---------------------------------------------------------------------------
// PromosPanel (generator + list combined)
// ---------------------------------------------------------------------------

const PromosPanel: React.FC = () => {
    const [showGenerator, setShowGenerator] = useState(true);
    const [buyModalOpen, setBuyModalOpen] = useState(false);
    return (
        <>
            <div style={{ display: 'flex', gap: 8 }}>
                <button
                    className={`cube-btn-secondary ${showGenerator ? 'active' : ''}`}
                    style={{ flex: 1 }}
                    onClick={(e) => { e.stopPropagation(); setShowGenerator(v => !v); }}
                >
                    {showGenerator ? 'Список кодов' : 'Создать код'}
                </button>
                <button
                    className="cube-btn-secondary"
                    onClick={(e) => { e.stopPropagation(); setBuyModalOpen(true); hapticImpact('light'); }}
                >
                    Купить пачку
                </button>
            </div>
            {showGenerator ? <CodeGeneratorPanel /> : <PromoListPanel />}
            {buyModalOpen && <BuyCodesModal onClose={() => setBuyModalOpen(false)} />}
        </>
    );
};

// ---------------------------------------------------------------------------
// AdminCube
// ---------------------------------------------------------------------------

const AdminCube: React.FC = () => {
    const [activeTab, setActiveTab] = useState<AdminTab>('promos');

    const switchTab = (tab: AdminTab) => (e: React.MouseEvent) => {
        e.stopPropagation();
        hapticImpact('light');
        setActiveTab(tab);
    };

    return (
        <div className="cube-module">
            <div className="cube-section-title">Админ-панель</div>
            <div className="tab-selector">
                <button className={`tab-selector-btn${activeTab === 'promos' ? ' active' : ''}`} onClick={switchTab('promos')}>Промокоды</button>
                <button className={`tab-selector-btn${activeTab === 'connections' ? ' active' : ''}`} onClick={switchTab('connections')}>Соединения</button>
                <button className={`tab-selector-btn${activeTab === 'settings' ? ' active' : ''}`} onClick={switchTab('settings')}>Настройки</button>
                <button className={`tab-selector-btn${activeTab === 'bans' ? ' active' : ''}`} onClick={switchTab('bans')}>Баны</button>
            </div>
            {activeTab === 'promos' && <PromosPanel />}
            {activeTab === 'connections' && <ConnectionsPanel />}
            {activeTab === 'settings' && <SettingsPanel />}
            {activeTab === 'bans' && <BanHistoryPanel />}
        </div>
    );
};

export default AdminCube;

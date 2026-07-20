import React, { useState, useCallback, useEffect, useRef } from 'react';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import {
    getConnections, toggleMaintenance, unbanUser,
    getMaintenanceStatus, getBanHistory,
} from '../../api/admin';
import type { MaintenanceStatus, ResponsibleGroup, BanHistoryEntry } from '../../api/admin';
import type { AccessTier } from '../../stores/authStore';
import {
    listCoupons, createCoupon, updateCoupon, deleteCoupon,
    listAdminTierPrices, updateTierPrice, setUserPricing,
    searchUsers, listSpecialUsers,
} from '../../api/adminPricing';
import type { Coupon, AdminTierPrice, PricingMode, AdminUserCard } from '../../api/adminPricing';
import {
    listPayments, refundPayment, listStarProducts, updateStarProduct, getStarsBalance,
} from '../../api/adminPayments';
import type { AdminPaymentRow, AdminStarProduct } from '../../api/adminPayments';
import TierBadge from '../common/TierBadge';
import BanUserModal from '../shared/BanUserModal';
import '../../styles/cubes.css';

type AdminTab = 'promos' | 'connections' | 'settings' | 'bans' | 'payments';

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
                                <th>XP</th>
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
                                            <td>{s?.total_xp_earned ?? '—'}</td>
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
                                                    <td>{p.stats?.drops_balance ?? 0} XP</td>
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
// PromosPanel
// ---------------------------------------------------------------------------

const TIER_LABELS: Record<AccessTier, string> = { standard: 'Standard', premium: 'Premium', elite: 'Elite' };

const CouponsSection: React.FC = () => {
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [pct, setPct] = useState('20');
    const [code, setCode] = useState('');
    const [maxUses, setMaxUses] = useState('');
    const [oncePerUser, setOncePerUser] = useState(true);
    const [creating, setCreating] = useState(false);
    const [toast, setToast] = useState('');
    const show = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600); };

    const reload = useCallback(() => {
        listCoupons().then(setCoupons).catch(() => {}).finally(() => setLoading(false));
    }, []);
    useEffect(() => { reload(); }, [reload]);

    const create = async () => {
        const p = parseInt(pct, 10);
        if (!Number.isFinite(p) || p < 1 || p > 99) { show('Скидка 1–99%'); return; }
        setCreating(true);
        try {
            await createCoupon({
                code: code.trim() || undefined,
                discount_pct: p,
                max_uses: maxUses ? parseInt(maxUses, 10) : null,
                once_per_user: oncePerUser,
            });
            hapticNotification('success'); setCode(''); setMaxUses(''); reload();
        } catch (e: any) {
            show(e?.response?.data?.detail?.code === 'CODE_EXISTS' ? 'Код уже существует' : 'Ошибка');
        } finally { setCreating(false); }
    };

    const toggle = async (c: Coupon) => { try { await updateCoupon(c.id, !c.is_active); reload(); } catch { /* ignore */ } };

    const copyCode = (c: Coupon) => {
        if (navigator.clipboard) { navigator.clipboard.writeText(c.code); show('Код скопирован'); }
    };

    const remove = async (c: Coupon) => {
        try {
            await deleteCoupon(c.id);
            hapticNotification('success'); show('Купон удалён'); reload();
        } catch (e: any) {
            const codeErr = e?.response?.data?.detail?.code;
            if (codeErr === 'COUPON_HAS_REFS') {
                // Referenced coupons can't be deleted — deactivate instead.
                if (c.is_active) { await updateCoupon(c.id, false).catch(() => {}); reload(); }
                show('Купон использован — выключен, не удалён');
            } else {
                show('Ошибка удаления');
            }
        }
    };

    return (
        <>
            <div className="cube-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input className="admin-generator-select" placeholder="Код (пусто = авто)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onClick={(e) => e.stopPropagation()} />
                <div style={{ display: 'flex', gap: 8 }}>
                    <label className="admin-field" style={{ flex: 1 }}>
                        <span className="admin-field-label">Скидка %</span>
                        <input className="admin-generator-select" type="number" min={1} max={99} value={pct} onChange={(e) => setPct(e.target.value)} onClick={(e) => e.stopPropagation()} />
                    </label>
                    <label className="admin-field" style={{ flex: 1 }}>
                        <span className="admin-field-label">Лимит применений (пусто = без лимита)</span>
                        <input className="admin-generator-select" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} onClick={(e) => e.stopPropagation()} />
                    </label>
                </div>
                <label className="admin-checkbox-row" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={oncePerUser} onChange={(e) => setOncePerUser(e.target.checked)} />
                    <span>Одно применение на юзера</span>
                </label>
                <button className="cube-btn-primary" disabled={creating} onClick={(e) => { e.stopPropagation(); create(); }}>{creating ? 'Создаём…' : 'Создать купон'}</button>
            </div>
            {loading ? <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка…</div> : (
                <div className="cube-card">
                    {coupons.length === 0 ? <div className="cube-locked-text">Нет купонов</div> : coupons.map(c => (
                        <div key={c.id} className="settings-row" style={{ gap: 8 }}>
                            <div className="settings-row-info">
                                <div className="cube-player-name">
                                    <span className="coupon-code">{c.code}</span>
                                    <span className="coupon-disc"> · −{c.discount_pct}%</span>
                                </div>
                                <div className="cube-player-meta">
                                    {c.used_count}{c.max_uses != null ? `/${c.max_uses}` : ''} исп.
                                    {c.once_per_user ? ' · 1/юзер' : ''} · {c.is_active ? 'активен' : 'выключен'}
                                </div>
                            </div>
                            <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); copyCode(c); }}>📋</button>
                            <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); toggle(c); }}>{c.is_active ? '🚫' : '✅'}</button>
                            <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); remove(c); }}>🗑</button>
                        </div>
                    ))}
                </div>
            )}
            {toast && <div className="admin-toast">{toast}</div>}
        </>
    );
};

const TierPricesSection: React.FC = () => {
    const [rows, setRows] = useState<AdminTierPrice[]>([]);
    const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [toast, setToast] = useState('');
    const show = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2000); };

    const reload = useCallback(() => {
        listAdminTierPrices().then(r => {
            setRows(r);
            setEdits(Object.fromEntries(r.map(x => [x.tier, {
                intro_price_stars: String(x.intro_price_stars), price_1m: String(x.price_1m),
                price_3m: String(x.price_3m), price_12m: String(x.price_12m),
            }])));
        }).catch(() => {}).finally(() => setLoading(false));
    }, []);
    useEffect(() => { reload(); }, [reload]);

    const save = async (tier: AccessTier) => {
        const e = edits[tier];
        const patch: Record<string, number> = {};
        for (const k of ['intro_price_stars', 'price_1m', 'price_3m', 'price_12m']) {
            const v = parseInt(e[k], 10);
            if (!Number.isFinite(v) || v < 1) { show('Цены ≥ 1'); return; }
            patch[k] = v;
        }
        setSaving(tier);
        try { await updateTierPrice(tier, patch); hapticNotification('success'); show('Сохранено'); reload(); }
        catch { show('Ошибка'); } finally { setSaving(null); }
    };

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка…</div>;
    const FIELDS: [string, string][] = [['intro_price_stars', 'Интро'], ['price_1m', '1 мес'], ['price_3m', '3 мес'], ['price_12m', '12 мес']];
    return (
        <>
            {rows.map(r => (
                <div key={r.tier} className="cube-card" style={{ marginBottom: 10 }}>
                    <div className="cube-player-name" style={{ marginBottom: 8 }}>{TIER_LABELS[r.tier]}</div>
                    {FIELDS.map(([key, label]) => (
                        <div key={key} className="settings-row" style={{ gap: 8 }}>
                            <div className="settings-row-info"><div className="cube-player-meta">{label}</div></div>
                            <input className="admin-generator-select" style={{ width: 90 }} type="number" min={1}
                                value={edits[r.tier]?.[key] ?? ''}
                                onChange={(ev) => setEdits(s => ({ ...s, [r.tier]: { ...s[r.tier], [key]: ev.target.value } }))}
                                onClick={(ev) => ev.stopPropagation()} />
                        </div>
                    ))}
                    <button className="cube-btn-primary" disabled={saving === r.tier} onClick={(e) => { e.stopPropagation(); save(r.tier); }}>{saving === r.tier ? 'Сохраняем…' : '💾 Сохранить'}</button>
                </div>
            ))}
            {toast && <div className="admin-toast">{toast}</div>}
        </>
    );
};

const PRICING_TIERS: AccessTier[] = ['standard', 'premium', 'elite'];
const TIER_LIMIT: Record<AccessTier, number> = { standard: 1, premium: 2, elite: 3 };

const UserPricingSection: React.FC = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<AdminUserCard[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<AdminUserCard | null>(null);
    const [mode, setMode] = useState<PricingMode>(null);
    const [custom, setCustom] = useState('');
    const [tier, setTier] = useState<AccessTier>('standard');
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState('');
    const show = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

    const runSearch = async () => {
        const q = query.trim();
        if (!q) return;
        setSearching(true);
        try { setResults(await searchUsers(q)); }
        catch { show('Ошибка поиска'); } finally { setSearching(false); }
    };

    const pick = (u: AdminUserCard) => {
        setSelected(u);
        setMode(u.pricing_mode);
        setCustom(u.custom_price_stars ? String(u.custom_price_stars) : '');
        setTier(u.responsible_access_tier ?? 'standard');
    };

    const apply = async () => {
        if (!selected) return;
        if (mode === 'custom' && (!custom || parseInt(custom, 10) < 1)) { show('Цена ≥ 1'); return; }
        setBusy(true);
        try {
            await setUserPricing(
                selected.id, mode,
                mode === 'custom' ? parseInt(custom, 10) : undefined,
                mode ? tier : undefined,
            );
            hapticNotification('success'); show('Режим применён');
            runSearch();
        } catch { show('Ошибка применения'); } finally { setBusy(false); }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="cube-card" style={{ display: 'flex', gap: 8 }}>
                <input className="admin-generator-select" style={{ flex: 1 }} placeholder="TG ID / username / имя" value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                    onClick={(e) => e.stopPropagation()} />
                <button className="cube-btn-sm" disabled={searching} onClick={(e) => { e.stopPropagation(); runSearch(); }}>🔍</button>
            </div>

            {results.length > 0 && !selected && (
                <div className="cube-card">
                    {results.map(u => (
                        <div key={u.id} className="settings-row" style={{ gap: 8 }} onClick={(e) => { e.stopPropagation(); pick(u); }}>
                            <div className="settings-row-info">
                                <div className="cube-player-name">{u.first_name || '—'} {u.telegram_username ? `@${u.telegram_username}` : ''}</div>
                                <div className="cube-player-meta">TG {u.telegram_id} · {u.pricing_mode ?? 'обычный'}{u.responsible_access_tier ? ` · ${u.responsible_access_tier}` : ''}</div>
                            </div>
                            <button className="cube-btn-sm">Выбрать</button>
                        </div>
                    ))}
                </div>
            )}
            {results.length === 0 && !selected && !searching && query.trim() && (
                <div className="cube-locked"><div className="cube-locked-text">Ничего не найдено</div></div>
            )}

            {selected && (
                <div className="cube-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="cube-player-name">{selected.first_name || '—'} {selected.telegram_username ? `@${selected.telegram_username}` : ''}</div>
                    <div className="cube-player-meta">TG {selected.telegram_id}</div>
                    <div className="tab-selector">
                        {([['normal', 'Обычный'], ['free', 'Бесплатно'], ['custom', 'Персональная']] as const).map(([m, label]) => {
                            const val: PricingMode = m === 'normal' ? null : m;
                            return (
                                <button key={m} className={`tab-selector-btn${mode === val ? ' active' : ''}`} onClick={(e) => { e.stopPropagation(); setMode(val); }}>{label}</button>
                            );
                        })}
                    </div>
                    {mode === 'custom' && (
                        <input className="admin-generator-select" type="number" min={1} placeholder="Цена ⭐ / мес" value={custom} onChange={(e) => setCustom(e.target.value)} onClick={(e) => e.stopPropagation()} />
                    )}
                    {mode && (
                        <label className="admin-field">
                            <span className="admin-field-label">Тариф (слоты)</span>
                            <div className="tab-selector">
                                {PRICING_TIERS.map(t => (
                                    <button key={t} className={`tab-selector-btn${tier === t ? ' active' : ''}`} onClick={(e) => { e.stopPropagation(); setTier(t); }}>
                                        {TIER_LABELS[t]} ·{TIER_LIMIT[t]}
                                    </button>
                                ))}
                            </div>
                        </label>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); setSelected(null); }}>← Назад</button>
                        <button className="cube-btn-primary" style={{ flex: 1 }} disabled={busy} onClick={(e) => { e.stopPropagation(); apply(); }}>{busy ? 'Применяем…' : 'Применить'}</button>
                    </div>
                </div>
            )}
            {toast && <div className="admin-toast">{toast}</div>}
        </div>
    );
};

const SpecialUsersSection: React.FC = () => {
    const [users, setUsers] = useState<AdminUserCard[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        listSpecialUsers().then(setUsers).catch(() => {}).finally(() => setLoading(false));
    }, []);
    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка…</div>;
    return (
        <div className="cube-card">
            {users.length === 0 ? <div className="cube-locked-text">Нет особых аккаунтов</div> : users.map(u => (
                <div key={u.id} className="settings-row" style={{ gap: 8 }}>
                    <div className="settings-row-info">
                        <div className="cube-player-name">{u.first_name || '—'} {u.telegram_username ? `@${u.telegram_username}` : ''}</div>
                        <div className="cube-player-meta">
                            TG {u.telegram_id} · {u.pricing_mode}
                            {u.responsible_access_tier ? ` · ${u.responsible_access_tier}` : ''}
                            {u.pricing_mode === 'custom' && u.custom_price_stars ? ` · ${u.custom_price_stars} ⭐` : ''}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

const PromosPanel: React.FC = () => {
    const [sub, setSub] = useState<'coupons' | 'tiers' | 'pricing' | 'special'>('coupons');
    return (
        <div className="admin-generator-form">
            <div className="tab-selector">
                {(['coupons', 'tiers', 'pricing', 'special'] as const).map(s => (
                    <button key={s} className={`tab-selector-btn${sub === s ? ' active' : ''}`} onClick={(e) => { e.stopPropagation(); setSub(s); hapticImpact('light'); }}>
                        {s === 'coupons' ? 'Купоны' : s === 'tiers' ? 'Тарифы' : s === 'pricing' ? 'Юзер' : 'Особые'}
                    </button>
                ))}
            </div>
            {sub === 'coupons' && <CouponsSection />}
            {sub === 'tiers' && <TierPricesSection />}
            {sub === 'pricing' && <UserPricingSection />}
            {sub === 'special' && <SpecialUsersSection />}
        </div>
    );
};

// ---------------------------------------------------------------------------
// PaymentsPanel — ⭐ Stars payments (balance, ledger + refunds, price editor)
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_LABEL: Record<string, string> = {
    pending: 'Ожидание', paid: 'Оплачен', fulfilled: 'Выполнен', failed: 'Ошибка', refunded: 'Возврат',
};

const PaymentsPanel: React.FC = () => {
    const [balance, setBalance] = useState<number | null>(null);
    const [payments, setPayments] = useState<AdminPaymentRow[]>([]);
    const [products, setProducts] = useState<AdminStarProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState('');
    const [confirmRefund, setConfirmRefund] = useState<AdminPaymentRow | null>(null);
    const [refunding, setRefunding] = useState<string | null>(null);
    const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
    const [savingProduct, setSavingProduct] = useState<string | null>(null);

    const showToast = (m: string, ms = 3000) => { setToast(m); setTimeout(() => setToast(''), ms); };

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [pmts, prods] = await Promise.all([listPayments(), listStarProducts()]);
            setPayments(pmts);
            setProducts(prods);
            setPriceEdits(Object.fromEntries(prods.map(p => [p.product_type, String(p.price_stars)])));
        } catch { /* ignore */ } finally {
            setLoading(false);
        }
        getStarsBalance().then(b => setBalance(b.amount)).catch(() => setBalance(null));
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const doRefund = useCallback(async (row: AdminPaymentRow) => {
        setConfirmRefund(null);
        setRefunding(row.id);
        try {
            const res = await refundPayment(row.id);
            hapticNotification('success');
            showToast(res.boost_deactivated ? 'Возврат оформлен, буст деактивирован' : 'Возврат оформлен');
            reload();
        } catch (err: any) {
            hapticNotification('error');
            const code = err?.response?.data?.detail?.code;
            showToast(code === 'NOT_REFUNDABLE' ? 'Платёж нельзя вернуть' : 'Ошибка возврата');
        } finally {
            setRefunding(null);
        }
    }, [reload]);

    const saveProduct = useCallback(async (pt: string) => {
        const price = parseInt(priceEdits[pt], 10);
        if (!Number.isFinite(price) || price < 1) { showToast('Цена должна быть ≥ 1'); return; }
        setSavingProduct(pt);
        try {
            await updateStarProduct(pt, { price_stars: price });
            hapticNotification('success');
            showToast('Цена сохранена');
            reload();
        } catch { hapticNotification('error'); showToast('Ошибка сохранения'); } finally {
            setSavingProduct(null);
        }
    }, [priceEdits, reload]);

    const toggleActive = useCallback(async (p: AdminStarProduct) => {
        setSavingProduct(p.product_type);
        try {
            await updateStarProduct(p.product_type, { is_active: !p.is_active });
            reload();
        } catch { showToast('Ошибка'); } finally {
            setSavingProduct(null);
        }
    }, [reload]);

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;

    return (
        <div className="pay-panel">
            <div className="pay-balance">
                <span>Баланс бота</span>
                <span className="pay-balance-value">{balance === null ? '—' : `${balance} ⭐`}</span>
            </div>

            <div className="cube-section-title pay-prices-title">Цены (Stars)</div>
            <div className="pay-prices">
                {products.map(p => (
                    <div key={p.product_type} className="pay-price-row">
                        <span className="pay-price-name">{p.title}</span>
                        <input
                            className="admin-generator-select"
                            style={{ width: 68 }}
                            type="number"
                            min={1}
                            value={priceEdits[p.product_type] ?? ''}
                            onChange={(e) => setPriceEdits(s => ({ ...s, [p.product_type]: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                        />
                        <button className="cube-btn-sm" disabled={savingProduct === p.product_type} onClick={(e) => { e.stopPropagation(); saveProduct(p.product_type); }}>💾</button>
                        <button className="cube-btn-sm" disabled={savingProduct === p.product_type} onClick={(e) => { e.stopPropagation(); toggleActive(p); }}>{p.is_active ? '🚫' : '✅'}</button>
                    </div>
                ))}
            </div>

            <div className="cube-section-title pay-prices-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Платежи</span>
                <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); reload(); hapticImpact('light'); }}>↻</button>
            </div>
            {payments.length === 0 ? (
                <div className="cube-locked"><div className="cube-locked-text">Нет платежей</div></div>
            ) : (
                <div className="pay-list">
                    {payments.map(pm => (
                        <div key={pm.id} className="pay-card">
                            <div className="pay-card-row">
                                <span className="pay-buyer">{pm.buyer_name || `#${pm.buyer_telegram_id ?? '?'}`}</span>
                                <span className="pay-amount">{pm.amount_stars} ⭐</span>
                            </div>
                            <div className="pay-product">
                                {pm.tier
                                    ? `${pm.tier} · ${pm.period}`
                                    : (pm.product_title || pm.product_type)}
                                {pm.coupon_code && (
                                    <span className="pay-coupon">{pm.coupon_code} −{pm.discount_pct}%</span>
                                )}
                            </div>
                            <div className="pay-card-row">
                                <span className={`pay-status pay-status-${pm.status}`}>
                                    {PAYMENT_STATUS_LABEL[pm.status] || pm.status}
                                    <span className="pay-date">{pm.created_at ? new Date(pm.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—'}</span>
                                </span>
                                {(pm.status === 'paid' || pm.status === 'fulfilled') && (
                                    <button className="cube-btn-sm" disabled={refunding === pm.id} onClick={(e) => { e.stopPropagation(); setConfirmRefund(pm); }}>↩️</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {confirmRefund && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
                    onClick={() => setConfirmRefund(null)}
                >
                    <div className="cube-card" style={{ maxWidth: 340, width: '100%' }} onClick={(e) => e.stopPropagation()}>
                        <div className="settings-confirm-text">
                            Вернуть {confirmRefund.amount_stars} ⭐ покупателю «{confirmRefund.buyer_name || confirmRefund.buyer_telegram_id}»? Буст будет деактивирован.
                        </div>
                        <div className="settings-confirm-btns" style={{ marginTop: 12 }}>
                            <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); setConfirmRefund(null); }}>Отмена</button>
                            <button
                                className="cube-btn-sm"
                                style={{ background: 'rgba(231,76,60,0.2)', color: '#e74c3c' }}
                                onClick={(e) => { e.stopPropagation(); doRefund(confirmRefund); }}
                            >
                                Вернуть
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && <div className="admin-toast">{toast}</div>}
        </div>
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
                <button className={`tab-selector-btn${activeTab === 'promos' ? ' active' : ''}`} onClick={switchTab('promos')}>Купоны</button>
                <button className={`tab-selector-btn${activeTab === 'connections' ? ' active' : ''}`} onClick={switchTab('connections')}>Соединения</button>
                <button className={`tab-selector-btn${activeTab === 'payments' ? ' active' : ''}`} onClick={switchTab('payments')}>⭐ Платежи</button>
                <button className={`tab-selector-btn${activeTab === 'settings' ? ' active' : ''}`} onClick={switchTab('settings')}>Настройки</button>
                <button className={`tab-selector-btn${activeTab === 'bans' ? ' active' : ''}`} onClick={switchTab('bans')}>Баны</button>
            </div>
            {activeTab === 'promos' && <PromosPanel />}
            {activeTab === 'connections' && <ConnectionsPanel />}
            {activeTab === 'payments' && <PaymentsPanel />}
            {activeTab === 'settings' && <SettingsPanel />}
            {activeTab === 'bans' && <BanHistoryPanel />}
        </div>
    );
};

export default AdminCube;

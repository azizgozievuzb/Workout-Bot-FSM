import React, { useState, useCallback, useEffect } from 'react';
import { createPromoCodes, listPromoCodes, getConnections } from '../../api/admin';
import type { PromoCodeInfo, ResponsibleGroup } from '../../api/admin';
import '../../styles/cubes.css';

const ConnectionsPanel: React.FC = () => {
    const [groups, setGroups] = useState<ResponsibleGroup[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getConnections().then(d => setGroups(d.groups)).catch(() => {}).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>;
    if (!groups.length) return <div className="cube-locked"><div className="cube-locked-text">Нет зарегистрированных пользователей</div></div>;

    return (
        <div className="cube-card">
            {groups.map(g => (
                <div key={g.telegram_id} className="connections-group">
                    <div className="connections-responsible">
                        <div className="cube-avatar" style={{ background: 'var(--tg-theme-button-color, #6c5ce7)' }}>R</div>
                        <div className="cube-player-info">
                            <div className="cube-player-name">{g.display_name || g.username || `#${g.telegram_id}`}</div>
                            <div className="cube-player-meta">{g.players.length} игр{g.players.length === 1 ? 'рок' : g.players.length < 5 ? 'рока' : 'роков'}</div>
                        </div>
                    </div>
                    {g.players.length === 0 ? (
                        <div className="connections-empty">нет игроков</div>
                    ) : (
                        g.players.map(p => (
                            <div key={p.telegram_id} className={`cube-player-row connections-player ${p.is_deactivated ? 'deactivated' : ''}`}>
                                <div className="cube-avatar" style={{ fontSize: 12, opacity: p.is_deactivated ? 0.4 : 1 }}>P</div>
                                <div className="cube-player-info">
                                    <div className="cube-player-name" style={{ opacity: p.is_deactivated ? 0.5 : 1 }}>
                                        {p.display_name || p.username || `#${p.telegram_id}`}
                                    </div>
                                    {p.is_deactivated && <div className="cube-player-meta" style={{ color: 'var(--tg-theme-destructive-text-color, #e74c3c)' }}>доступ истёк</div>}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ))}
        </div>
    );
};

const AdminCube: React.FC = () => {
    const [codes, setCodes] = useState<PromoCodeInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [toast, setToast] = useState('');
    const [filterUsed, setFilterUsed] = useState<boolean | undefined>(undefined);
    const [showConnections, setShowConnections] = useState(false);

    const fetchCodes = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listPromoCodes(
                filterUsed !== undefined ? { is_used: filterUsed } : undefined
            );
            setCodes(data.codes);
        } catch { /* ignore */ }
        setLoading(false);
    }, [filterUsed]);

    useEffect(() => { fetchCodes(); }, [fetchCodes]);

    const handleCreate = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        setCreating(true);
        try {
            const data = await createPromoCodes('basic', 1);
            setToast(`Создан: ${data.codes[0]}`);
            setTimeout(() => setToast(''), 3000);
            fetchCodes();
        } catch {
            setToast('Ошибка создания');
            setTimeout(() => setToast(''), 3000);
        }
        setCreating(false);
    }, [fetchCodes]);

    const copyCode = useCallback((e: React.MouseEvent, code: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(code);
        setToast('Скопировано!');
        setTimeout(() => setToast(''), 2000);
    }, []);

    return (
        <div className="cube-module">
            <div className="cube-section-title">Админ-панель</div>

            <button
                className={`cube-btn-secondary ${showConnections ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setShowConnections(v => !v); }}
            >
                {showConnections ? 'Промокоды' : 'Соединения'}
            </button>

            {showConnections ? (
                <ConnectionsPanel />
            ) : (
                <>
                    <button
                        className="cube-btn-primary"
                        onClick={handleCreate}
                        disabled={creating}
                    >
                        {creating ? 'Создаём...' : 'Создать промокод'}
                    </button>

                    {toast && (
                        <div className="admin-toast">{toast}</div>
                    )}

                    <div className="cube-tabs">
                        <button
                            className={`cube-tab ${filterUsed === undefined ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setFilterUsed(undefined); }}
                        >
                            Все
                        </button>
                        <button
                            className={`cube-tab ${filterUsed === false ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setFilterUsed(false); }}
                        >
                            Свободные
                        </button>
                        <button
                            className={`cube-tab ${filterUsed === true ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setFilterUsed(true); }}
                        >
                            Использованные
                        </button>
                    </div>

                    {loading ? (
                        <div className="cube-section-title" style={{ textAlign: 'center' }}>Загрузка...</div>
                    ) : codes.length === 0 ? (
                        <div className="cube-locked">
                            <div className="cube-locked-text">Промокодов пока нет</div>
                        </div>
                    ) : (
                        <div className="cube-card">
                            {codes.map(c => (
                                <div className="cube-player-row" key={c.id}>
                                    <div className="cube-avatar" style={{ fontSize: 14, fontFamily: 'monospace' }}>
                                        {c.code_type === 'responsible' ? 'R' : c.code_type === 'player' ? 'P' : 'A'}
                                    </div>
                                    <div className="cube-player-info">
                                        <div className="cube-player-name" style={{ fontFamily: 'monospace', letterSpacing: 1 }}>
                                            {c.code}
                                        </div>
                                        <div className="cube-player-meta">
                                            {c.tier} · {c.is_used ? `Использован` : 'Свободен'}
                                            {c.created_at && ` · ${new Date(c.created_at).toLocaleDateString()}`}
                                        </div>
                                    </div>
                                    <div className="cube-player-actions">
                                        {!c.is_used && (
                                            <button className="cube-btn-sm" onClick={(e) => copyCode(e, c.code)}>
                                                📋
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default AdminCube;

import React, { useState, useCallback, useEffect } from 'react';
import { createPromoCodes, listPromoCodes } from '../../api/admin';
import type { PromoCodeInfo } from '../../api/admin';
import '../../styles/cubes.css';

const AdminCube: React.FC = () => {
    const [codes, setCodes] = useState<PromoCodeInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [toast, setToast] = useState('');
    const [filterUsed, setFilterUsed] = useState<boolean | undefined>(undefined);

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
        </div>
    );
};

export default AdminCube;

import React, { useState, useCallback, useEffect } from 'react';
import { hapticImpact } from '../../utils/haptic';
import { listPromoCodes, getConnections } from '../../api/admin';
import { createResponsibleCode, createRenewalCode } from '../../api/promo';
import type { AccessTier, DurationDays } from '../../api/promo';
import type { PromoCodeInfo, ResponsibleGroup } from '../../api/admin';
import TierBadge from '../common/TierBadge';
import '../../styles/cubes.css';

type GeneratorMode = 'responsible' | 'renewal';

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

    const handleModeChange = (m: GeneratorMode) => {
        hapticImpact('light');
        setMode(m);
        setGeneratedCode(null);
    };

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
                    onClick={(e) => { e.stopPropagation(); handleModeChange('responsible'); }}
                >
                    R-код
                </button>
                <button
                    className={`tab-selector-btn${mode === 'renewal' ? ' active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleModeChange('renewal'); }}
                >
                    Renewal-код
                </button>
            </div>

            <div className="admin-generator-hint">
                {mode === 'responsible'
                    ? 'Новый Ответственный'
                    : 'Продление для Игрока'}
            </div>

            <select
                className="admin-generator-select"
                value={tier}
                onChange={(e) => { e.stopPropagation(); setTier(e.target.value as AccessTier); }}
                onClick={(e) => e.stopPropagation()}
            >
                {TIER_OPTIONS.map(t => (
                    <option key={t} value={t}>{TIER_LABELS[t]}</option>
                ))}
            </select>

            <select
                className="admin-generator-select"
                value={duration}
                onChange={(e) => { e.stopPropagation(); setDuration(Number(e.target.value) as DurationDays); }}
                onClick={(e) => e.stopPropagation()}
            >
                {DURATION_OPTIONS.map(d => (
                    <option key={d} value={d}>{d} дней</option>
                ))}
            </select>

            <button
                className="cube-btn-primary"
                onClick={handleGenerate}
                disabled={generating}
            >
                {generating ? 'Создаём...' : 'Создать код'}
            </button>

            {generatedCode && (
                <div className="code-display">
                    <code className="code-display-text">{generatedCode}</code>
                    <button className="cube-btn-sm" onClick={copyToClipboard}>📋</button>
                    <TierBadge tier={tier} />
                    <span className="code-display-meta">{duration} дн.</span>
                </div>
            )}

            {toast && <div className="admin-toast">{toast}</div>}
        </div>
    );
};

const AdminCube: React.FC = () => {
    const [codes, setCodes] = useState<PromoCodeInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [filterUsed, setFilterUsed] = useState<boolean | undefined>(undefined);
    const [showConnections, setShowConnections] = useState(false);
    const [showGenerator, setShowGenerator] = useState(true);

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

    const copyCode = useCallback((e: React.MouseEvent, code: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(code);
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
                        className={`cube-btn-secondary ${showGenerator ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setShowGenerator(v => !v); }}
                    >
                        {showGenerator ? 'Список кодов' : 'Создать код'}
                    </button>

                    {showGenerator ? (
                        <CodeGeneratorPanel />
                    ) : (
                        <>
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
                                                    {c.tier} · {c.is_used ? 'Использован' : 'Свободен'}
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
                </>
            )}
        </div>
    );
};

export default AdminCube;

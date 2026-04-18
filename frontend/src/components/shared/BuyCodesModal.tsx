import React, { useState, useRef, useCallback } from 'react';
import { batchBuyCodes } from '../../api/admin';
import type { BatchCodeType } from '../../api/admin';
import type { AccessTier, DurationDays } from '../../api/promo';
import { hapticNotification, hapticImpact } from '../../utils/haptic';
import './BuyCodesModal.css';

interface Props {
    onClose: () => void;
}

const TIER_OPTIONS: AccessTier[] = ['standard', 'premium', 'elite'];
const TIER_LABELS: Record<AccessTier, string> = { standard: 'Standard', premium: 'Premium', elite: 'Elite' };
const DURATION_OPTIONS: DurationDays[] = [7, 30, 90, 180];
const COUNT_OPTIONS = [1, 5, 10, 25, 50] as const;
const TYPE_OPTIONS: { value: BatchCodeType; label: string }[] = [
    { value: 'responsible', label: 'Responsible' },
    { value: 'player', label: 'Player' },
    { value: 'renewal', label: 'Renewal' },
];

const BuyCodesModal: React.FC<Props> = ({ onClose }) => {
    const [codeType, setCodeType] = useState<BatchCodeType>('responsible');
    const [tier, setTier] = useState<AccessTier>('standard');
    const [duration, setDuration] = useState<DurationDays>(30);
    const [count, setCount] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [codes, setCodes] = useState<string[] | null>(null);
    const [toast, setToast] = useState('');

    const sheetRef = useRef<HTMLDivElement>(null);
    const touchStartY = useRef(0);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (e.changedTouches[0].clientY - touchStartY.current > 80) onClose();
    }, [onClose]);

    const handleSubmit = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        setSubmitting(true);
        try {
            const res = await batchBuyCodes({ code_type: codeType, tier, duration, count });
            setCodes(res.codes);
            hapticNotification('success');
        } catch {
            setToast('Ошибка генерации');
            setTimeout(() => setToast(''), 2500);
        } finally {
            setSubmitting(false);
        }
    }, [codeType, tier, duration, count]);

    const copyAll = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!codes) return;
        navigator.clipboard.writeText(codes.join('\n'));
        hapticImpact('medium');
        setToast('Все коды скопированы!');
        setTimeout(() => setToast(''), 2000);
    }, [codes]);

    const copySingle = useCallback((code: string, e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(code);
        hapticImpact('light');
    }, []);

    const handleComingSoon = (method: string) => {
        hapticNotification('warning');
        setToast(`${method} оплата — скоро`);
        setTimeout(() => setToast(''), 2500);
    };

    return (
        <div
            className="buy-modal-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={sheetRef}
                className="buy-modal-sheet"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="buy-modal-handle" />
                <div className="buy-modal-title">Купить пачку кодов</div>

                {!codes ? (
                    <>
                        <div className="buy-modal-label">Тип кода</div>
                        <div className="buy-modal-chips">
                            {TYPE_OPTIONS.map(o => (
                                <button
                                    key={o.value}
                                    className={`buy-modal-chip${codeType === o.value ? ' active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); setCodeType(o.value); hapticImpact('light'); }}
                                >
                                    {o.label}
                                </button>
                            ))}
                        </div>

                        <div className="buy-modal-label">Тир</div>
                        <div className="buy-modal-chips">
                            {TIER_OPTIONS.map(t => (
                                <button
                                    key={t}
                                    className={`buy-modal-chip${tier === t ? ' active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); setTier(t); hapticImpact('light'); }}
                                >
                                    {TIER_LABELS[t]}
                                </button>
                            ))}
                        </div>

                        <div className="buy-modal-label">Срок (дней)</div>
                        <div className="buy-modal-chips">
                            {DURATION_OPTIONS.map(d => (
                                <button
                                    key={d}
                                    className={`buy-modal-chip${duration === d ? ' active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); setDuration(d); hapticImpact('light'); }}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>

                        <div className="buy-modal-label">Количество</div>
                        <div className="buy-modal-chips">
                            {COUNT_OPTIONS.map(n => (
                                <button
                                    key={n}
                                    className={`buy-modal-chip${count === n ? ' active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); setCount(n); hapticImpact('light'); }}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>

                        <div className="payment-methods">
                            <div className="payment-methods-label">Способ оплаты</div>
                            <div className="payment-methods-row">
                                <button
                                    className="payment-method payment-method--active"
                                    onClick={(e) => { e.stopPropagation(); }}
                                >
                                    <span className="payment-method-icon">🎁</span>
                                    <span className="payment-method-label">Free</span>
                                    <span className="payment-method-badge">admin</span>
                                </button>
                                <button
                                    className="payment-method payment-method--disabled"
                                    onClick={(e) => { e.stopPropagation(); handleComingSoon('Stars'); }}
                                >
                                    <span className="payment-method-icon">⭐</span>
                                    <span className="payment-method-label">Stars</span>
                                    <span className="payment-method-badge">скоро</span>
                                </button>
                                <button
                                    className="payment-method payment-method--disabled"
                                    onClick={(e) => { e.stopPropagation(); handleComingSoon('Crypto'); }}
                                >
                                    <span className="payment-method-icon">💎</span>
                                    <span className="payment-method-label">Crypto</span>
                                    <span className="payment-method-badge">скоро</span>
                                </button>
                            </div>
                        </div>

                        <button className="buy-modal-submit" onClick={handleSubmit} disabled={submitting}>
                            {submitting ? 'Генерируем...' : `Сгенерировать ${count} ${count === 1 ? 'код' : 'кодов'}`}
                        </button>
                    </>
                ) : (
                    <>
                        <div className="buy-modal-result-header">
                            <span className="buy-modal-result-count">{codes.length} кодов готовы</span>
                            <button className="buy-modal-copy-all" onClick={copyAll}>Скопировать все</button>
                        </div>
                        <div className="batch-buy-result">
                            {codes.map((c, i) => (
                                <div key={i} className="batch-buy-result-row">
                                    <code className="batch-buy-code">{c}</code>
                                    <button className="buy-modal-chip-copy" onClick={(e) => copySingle(c, e)}>📋</button>
                                </div>
                            ))}
                        </div>
                        <button className="buy-modal-reset" onClick={(e) => { e.stopPropagation(); setCodes(null); }}>
                            Сгенерировать ещё
                        </button>
                    </>
                )}

                {toast && <div className="buy-modal-toast">{toast}</div>}
                <button className="buy-modal-cancel" onClick={(e) => { e.stopPropagation(); onClose(); }}>Закрыть</button>
            </div>
        </div>
    );
};

export default BuyCodesModal;

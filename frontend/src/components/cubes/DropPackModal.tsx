import React, { useCallback, useEffect, useState } from 'react';
import { createDropPackInvoice, getDropPacks } from '../../api/payments';
import type { DropPack } from '../../api/payments';
import { openStarInvoice, pollPayment } from '../../utils/starPayment';
import { hapticNotification } from '../../utils/haptic';

/* 8d (§8.7): наставник пополняет пул капель за Stars. Механика 7.4 —
   invoice link → tg.openInvoice → поллинг СВОЕЙ базы (Telegram-статус не истина). */

interface Props {
    onClose: () => void;
    onCredited: () => void;      // успех → перечитать баланс
}

const DropPackModal: React.FC<Props> = ({ onClose, onCredited }) => {
    const [packs, setPacks] = useState<DropPack[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    useEffect(() => {
        getDropPacks()
            .then(setPacks)
            .catch(() => setMsg('Не удалось загрузить пакеты'))
            .finally(() => setLoading(false));
    }, []);

    const buy = useCallback(async (packKey: string) => {
        if (busy) return;
        setBusy(true);
        setMsg('');
        try {
            const { payment_id, invoice_link } = await createDropPackInvoice(packKey);
            const opened = openStarInvoice(invoice_link, async (status) => {
                if (status === 'paid') {
                    setMsg('Оплата получена, зачисляем капли…');
                    const res = await pollPayment(payment_id);
                    if (res === 'fulfilled') {
                        hapticNotification('success');
                        onCredited();
                        onClose();
                        return;
                    }
                    setMsg(res === 'timeout'
                        ? 'Оплата обрабатывается — капли зачислятся автоматически'
                        : 'Не удалось зачислить капли');
                } else {
                    setMsg(status === 'cancelled' ? 'Покупка отменена' : 'Оплата не прошла');
                }
                setBusy(false);
            });
            if (!opened) { setMsg('Оплата недоступна в этом клиенте'); setBusy(false); }
        } catch {
            setMsg('Не удалось создать счёт');
            setBusy(false);
        }
    }, [busy, onClose, onCredited]);

    return (
        <div className="cube-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className="cube-modal-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="cube-modal-handle" />
                <div className="cube-modal-title">Пополнить капли</div>
                <div className="cube-modal-subtitle">
                    Капли попадут в ваш пул подарков — дарить их можно на странице игрока.
                </div>

                {loading ? (
                    <div className="cube-modal-empty">Загрузка…</div>
                ) : packs.length === 0 ? (
                    <div className="cube-modal-empty">Пакеты временно недоступны</div>
                ) : (
                    <div className="drop-pack-grid">
                        {packs.map((p) => (
                            <button key={p.key} className="drop-pack-card" disabled={busy}
                                onClick={(e) => { e.stopPropagation(); buy(p.key); }}>
                                <span className="drop-pack-amount">{p.drops} 💧</span>
                                <span className="drop-pack-price">{p.price_stars} ⭐</span>
                            </button>
                        ))}
                    </div>
                )}

                {msg && <div className="cube-modal-error">{msg}</div>}

                <button className="cube-modal-btn cube-modal-btn--ghost" disabled={busy}
                    onClick={(e) => { e.stopPropagation(); onClose(); }}>
                    Закрыть
                </button>
            </div>
        </div>
    );
};

export default DropPackModal;

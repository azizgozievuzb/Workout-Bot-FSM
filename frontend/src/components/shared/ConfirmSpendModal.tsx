import React, { useCallback, useEffect, useRef } from 'react';
import { hapticImpact } from '../../utils/haptic';

/* П.7 (решение S62, BACKLOG S59 №1) — единое окно подтверждения НЕОБРАТИМОЙ
   траты капель.

   Показывается ВСЕГДА: механизма «больше не спрашивать» нет ни в каком виде —
   ни галочки, ни localStorage, ни настройки. Причина: трата необратима, а
   «привык и промахнулся» — самая дорогая ошибка игрока.

   Окно живёт на общих классах .cube-modal-* (они — на `--tg-theme-*`
   переменных). Тема-классы `.dark-theme`/`.light-theme` висят ВНУТРИ дерева
   приложения и до модалок не достают (урок №2 PLAYBOOK) — поэтому никаких
   собственных цветов здесь нет. */

interface Props {
    /** Что покупаем — заголовок окна. */
    title: string;
    /** Цена в каплях. null — трата не в каплях (например, подаренная попытка). */
    price: number | null;
    /** Баланс ДО списания; из него считается остаток. */
    balance: number;
    /** Строка вместо цены, когда списываются не капли (подарок наставника). */
    freeLabel?: string;
    /** Пояснение под ценой: что именно получит игрок. */
    note?: string;
    confirmLabel?: string;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmSpendModal: React.FC<Props> = ({
    title, price, balance, freeLabel, note, confirmLabel = 'Купить',
    busy = false, onConfirm, onCancel,
}) => {
    const touchStartY = useRef(0);

    useEffect(() => { hapticImpact('light'); }, []);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
    }, []);
    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const delta = e.changedTouches[0].clientY - touchStartY.current;
        if (delta > 80 && !busy) onCancel();
    }, [onCancel, busy]);

    const enough = price === null || balance >= price;

    return (
        <div
            className="cube-modal-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
        >
            <div
                className="cube-modal-sheet"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="cube-modal-handle" />
                <div className="cube-modal-title">{title}</div>

                <div className="confirm-spend-line">
                    {price === null ? (
                        <>{freeLabel ?? 'Капли не спишутся'}</>
                    ) : (
                        <>
                            Спишется <b>{price} 💧</b>
                            <span className="confirm-spend-rest">
                                {enough
                                    ? `Останется ${balance - price} 💧`
                                    : `У тебя только ${balance} 💧`}
                            </span>
                        </>
                    )}
                </div>

                {note && <div className="cube-modal-body">{note}</div>}

                <div className="cube-modal-actions">
                    <button
                        type="button"
                        className="cube-modal-btn cube-modal-btn--ghost"
                        onClick={(e) => { e.stopPropagation(); onCancel(); }}
                        disabled={busy}
                    >
                        Отменить
                    </button>
                    <button
                        type="button"
                        className="cube-modal-btn cube-modal-btn--primary"
                        onClick={(e) => { e.stopPropagation(); onConfirm(); }}
                        disabled={busy || !enough}
                    >
                        {busy ? '…' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmSpendModal;

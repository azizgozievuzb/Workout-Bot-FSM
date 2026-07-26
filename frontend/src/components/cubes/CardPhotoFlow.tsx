import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    cardPhotoChoose, cardPhotoPurchase, cardPhotoReroll, cardPhotoUpload,
    getPlayerShop,
} from '../../api/shop';
import type { CardPhotoState } from '../../api/shop';
import { hapticNotification } from '../../utils/haptic';

interface Props {
    card: CardPhotoState;
    prices: Record<string, number>;
    balance: number;
    onClose: () => void;
    // Синхронизация витрины после каждого шага (новый баланс подтянет родитель).
    onChanged: () => void;
}

/**
 * Фото-карточка (8.8b) — флоу: покупка → «AI / как есть» → селфи →
 * (AI) 2 варианта → выбрать / реролл → превью «так тебя видит наставник».
 */
const CardPhotoFlow: React.FC<Props> = ({ card, prices, balance, onClose, onChanged }) => {
    const [state, setState] = useState<CardPhotoState>(card);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [mode, setMode] = useState<'ai' | 'raw' | null>(null);
    const [chosenUrl, setChosenUrl] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const cameraRef = useRef<HTMLInputElement | null>(null);
    const pollRef = useRef<number | null>(null);

    const price = prices['photo_card'] ?? 200;
    const rerollPrice = prices['photo_reroll'] ?? 60;

    const apply = useCallback((s: CardPhotoState) => {
        setState(s);
        onChanged();
    }, [onChanged]);

    const fail = useCallback((e: any, fallback: string) => {
        hapticNotification('error');
        const detail = e?.response?.data?.detail;
        const code = typeof detail === 'object' ? detail?.code : '';
        setMsg(code === 'INSUFFICIENT_DROPS' ? `Недостаточно капель (${detail?.balance}/${detail?.price})` : fallback);
    }, []);

    // Поллинг во время фоновой генерации вариантов.
    useEffect(() => {
        if (state.status !== 'processing') {
            if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
            return;
        }
        pollRef.current = window.setInterval(async () => {
            try {
                const shop = await getPlayerShop();
                if (shop.card_photo.status !== 'processing') {
                    apply(shop.card_photo);
                }
            } catch { /* keep polling */ }
        }, 3000);
        return () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };
    }, [state.status, apply]);

    const doPurchase = useCallback(async () => {
        if (busy) return;
        setBusy(true); setMsg('');
        try {
            apply(await cardPhotoPurchase());
            hapticNotification('success');
        } catch (e: any) { fail(e, 'Не удалось купить'); }
        finally { setBusy(false); }
    }, [busy, apply, fail]);

    const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !mode) return;
        setBusy(true); setMsg('');
        try {
            const b64 = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result));
                r.onerror = reject;
                r.readAsDataURL(file);
            });
            const s = await cardPhotoUpload(b64, mode);
            hapticNotification('success');
            if (mode === 'raw') setChosenUrl(s.url);
            apply(s);
        } catch (e: any) { fail(e, 'Не удалось загрузить фото'); }
        finally { setBusy(false); }
    }, [mode, apply, fail]);

    const doChoose = useCallback(async (index: number) => {
        if (busy) return;
        setBusy(true); setMsg('');
        try {
            const s = await cardPhotoChoose(index);
            hapticNotification('success');
            setChosenUrl(s.url);
            apply(s);
        } catch (e: any) { fail(e, 'Не удалось выбрать'); }
        finally { setBusy(false); }
    }, [busy, apply, fail]);

    const doReroll = useCallback(async () => {
        if (busy) return;
        setBusy(true); setMsg('');
        try {
            apply(await cardPhotoReroll());
            hapticNotification('success');
        } catch (e: any) { fail(e, 'Не удалось сгенерировать'); }
        finally { setBusy(false); }
    }, [busy, apply, fail]);

    // ---- этап флоу из состояния ----
    const status = state.status;
    let body: React.ReactNode;

    if (chosenUrl) {
        // Превью «так тебя видит наставник»
        body = (
            <>
                <div className="cardflow-title">Готово ✨</div>
                <img className="cardflow-preview" src={chosenUrl} alt="Фото-карточка" />
                <div className="cardflow-hint">Так тебя видит наставник.</div>
                <button className="cube-btn-primary" onClick={onClose}>Отлично</button>
            </>
        );
    } else if (status === 'choosing' && state.variants.length > 0) {
        body = (
            <>
                <div className="cardflow-title">Выбери вариант</div>
                <div className="cardflow-variants">
                    {state.variants.map((v, i) => (
                        <div key={v} className="cardflow-variant">
                            <img src={v} alt={`Вариант ${i + 1}`} />
                            <button className="cube-btn-sm" disabled={busy} onClick={() => doChoose(i)}>
                                Выбрать
                            </button>
                        </div>
                    ))}
                </div>
                <button className="cube-btn-sm" disabled={busy} onClick={doReroll}>
                    🎲 Ещё 2 варианта ({rerollPrice} 💧)
                </button>
            </>
        );
    } else if (status === 'processing') {
        body = (
            <>
                <div className="cardflow-title">Обрабатываем…</div>
                <div className="cardflow-hint">AI готовит 2 варианта — обычно до минуты. Можно не закрывать окно.</div>
                <div className="shop-skeleton-card" style={{ height: 120 }} />
            </>
        );
    } else if (status === 'awaiting_photo' || status === 'failed') {
        body = (
            <>
                {mode === null ? (
                    <>
                        <div className="cardflow-title">{status === 'failed' ? 'Не получилось — попробуй ещё раз' : 'Загрузи селфи'}</div>
                        <button
                            className="cube-btn-primary"
                            disabled={busy}
                            onClick={() => setMode('ai')}
                        >
                            ✨ Обработать AI
                        </button>
                        <button
                            className="cube-btn-sm"
                            disabled={busy}
                            onClick={() => setMode('raw')}
                        >
                            📷 Поставить как есть (без AI)
                        </button>
                        <div className="cardflow-hint">
                            «Как есть» — фото не отправляется в AI и сразу становится карточкой.
                        </div>
                    </>
                ) : (
                    <>
                        <div className="cardflow-title">Откуда фото?</div>
                        <button
                            className="cube-btn-primary"
                            disabled={busy}
                            onClick={() => cameraRef.current?.click()}
                        >
                            📸 Сделать фото
                        </button>
                        <button
                            className="cube-btn-sm"
                            disabled={busy}
                            onClick={() => fileRef.current?.click()}
                        >
                            🖼 Выбрать из галереи
                        </button>
                        <button className="cube-btn-sm" disabled={busy} onClick={() => setMode(null)}>
                            ← Назад
                        </button>
                    </>
                )}
            </>
        );
    } else {
        // Покупка (первая или повторная смена — снова полная цена)
        body = (
            <>
                <div className="cardflow-title">Своё фото на карточке</div>
                {state.url && (
                    <img className="cardflow-preview" src={state.url} alt="Текущая карточка" />
                )}
                <div className="cardflow-hint">
                    {state.url
                        ? 'Сейчас наставник видит это фото. Смена — снова полная цена.'
                        : 'Пока наставник видит мультяшный образ. Поставь своё фото: AI-обработка (2 варианта на выбор) или «как есть».'}
                </div>
                <button className="cube-btn-primary" disabled={busy || balance < price} onClick={doPurchase}>
                    {state.url ? 'Сменить фото' : 'Купить'} — {price} 💧
                </button>
                {balance < price && <div className="cardflow-hint">Недостаточно капель ({balance}/{price})</div>}
            </>
        );
    }

    return (
        <div className="cardflow-backdrop" onClick={() => { if (!busy) onClose(); }}>
            <div className="cardflow-card" onClick={(e) => e.stopPropagation()}>
                {body}
                {msg && <div className="cardflow-msg">{msg}</div>}
                <button className="cardflow-close" onClick={onClose}>Закрыть</button>
                <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={onFile}
                />
                {/* Съёмка камерой (фронталка) — хотфикс смоука 8c, находка №11 */}
                <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    style={{ display: 'none' }}
                    onChange={onFile}
                />
            </div>
        </div>
    );
};

export default CardPhotoFlow;

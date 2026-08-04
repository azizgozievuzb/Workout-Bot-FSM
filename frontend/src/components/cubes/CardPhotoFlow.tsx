import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    KEEP_ORIGINAL_INDEX,
    cardPhotoChoose, cardPhotoPurchase, cardPhotoReroll, cardPhotoUpload,
    getPlayerShop,
} from '../../api/shop';
import type { CardPhotoState, CardVariantMode } from '../../api/shop';
import { hapticNotification } from '../../utils/haptic';

/* 8d.1 (П.10, находка №27): подписи режимов обработки. Раньше выдавались два
   случайных прогона одного промпта — сходство скакало и это читалось как баг.
   Теперь варианты РАЗНЫЕ по замыслу, и экран прямо говорит, чем они отличаются
   (П.3b: термин + короткая расшифровка). */
const VARIANT_LABEL: Record<CardVariantMode, { title: string; hint: string }> = {
    weak: { title: 'Слабая обработка', hint: 'максимум сходства с фото' },
    deep: { title: 'Глубокая обработка', hint: 'заметная стилизация' },
};

interface Props {
    card: CardPhotoState;
    balance: number;
    aiPrice: number;        // 8c.1: актуальная для юзера цена AI-смены (прогрессия)
    rawPrice: number;       // фикс-цена «как есть»
    rerollPrice: number;    // актуальная цена реролла (прогрессия)
    /* 8d: подаренные наставником попытки. RPC begin_card_reroll тратит их ПЕРВЫМИ
       (капли не списываются, прогрессия цены не растёт), но в UI их не было
       видно вовсе — игрок с оплаченным кредитом смотрел на цену в каплях и не
       понимал, за что платит (смоук 8d.1, п.12). */
    rerollCredits: number;
    onClose: () => void;
    // Синхронизация витрины после каждого шага (новый баланс подтянет родитель).
    onChanged: () => void;
}

/**
 * Фото-карточка (8.8b + 8c.1) — флоу: выбор режима (AI прогрессивная цена /
 * raw фикс) → покупка → селфи (камера getUserMedia / input capture / галерея) →
 * (AI) 2 варианта → выбрать / реролл (прогрессия) → превью «так тебя видит наставник».
 */
const CardPhotoFlow: React.FC<Props> = ({
    card, balance, aiPrice, rawPrice, rerollPrice, rerollCredits, onClose, onChanged,
}) => {
    const [state, setState] = useState<CardPhotoState>(card);
    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState('');
    const [msg, setMsg] = useState('');
    const [chosenUrl, setChosenUrl] = useState<string | null>(null);
    const [camOpen, setCamOpen] = useState(false);
    // Кадры реально пошли (есть videoWidth): без этого снимок был бы чёрным.
    const [camReady, setCamReady] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const cameraRef = useRef<HTMLInputElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const pollRef = useRef<number | null>(null);

    // Режим текущего флоу фиксируется сервером при покупке (state.mode).
    const mode: 'ai' | 'raw' = state.mode ?? 'ai';

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

    const stopCamera = useCallback(() => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setCamReady(false);
        setCamOpen(false);
    }, []);

    // Привязка потока к <video> строго после рендера камеры (фикс iOS-webview:
    // без этого превью оставалось чёрным, а снимок уходил пустым кадром).
    useEffect(() => {
        if (!camOpen) return;
        const v = videoRef.current;
        const stream = streamRef.current;
        if (!v || !stream) return;
        v.srcObject = stream;
        v.muted = true;
        const onReady = () => { if (v.videoWidth > 0) setCamReady(true); };
        v.addEventListener('loadedmetadata', onReady);
        v.addEventListener('canplay', onReady);
        v.play().then(onReady).catch(() => undefined);
        return () => {
            v.removeEventListener('loadedmetadata', onReady);
            v.removeEventListener('canplay', onReady);
        };
    }, [camOpen]);

    useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

    // ---- действия (все с double-submit guard: busy до ответа сервера) ----

    const doPurchase = useCallback(async (m: 'ai' | 'raw') => {
        if (busy) return;
        setBusy(true); setBusyLabel('purchase:' + m); setMsg('');
        try {
            apply(await cardPhotoPurchase(m));
            hapticNotification('success');
        } catch (e: any) { fail(e, 'Не удалось купить'); }
        finally { setBusy(false); setBusyLabel(''); }
    }, [busy, apply, fail]);

    const uploadB64 = useCallback(async (b64: string) => {
        setBusy(true); setBusyLabel('upload'); setMsg('');
        try {
            const s = await cardPhotoUpload(b64, mode);
            hapticNotification('success');
            if (mode === 'raw') setChosenUrl(s.url);
            apply(s);
        } catch (e: any) { fail(e, 'Не удалось загрузить фото'); }
        finally { setBusy(false); setBusyLabel(''); }
    }, [mode, apply, fail]);

    const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || busy) return;
        const b64 = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = reject;
            r.readAsDataURL(file);
        }).catch(() => null as string | null);
        if (!b64) { setMsg('Не удалось прочитать файл'); return; }
        await uploadB64(b64);
    }, [busy, uploadB64]);

    // Селфи-капчер (8c.1): getUserMedia с живым превью; фолбэки —
    // input capture (мобильный шорткат) → файловый пикер.
    const openCamera = useCallback(async () => {
        if (busy) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' }, audio: false,
            });
            streamRef.current = stream;
            setCamReady(false);
            setCamOpen(true);
            // srcObject привязывается в useEffect ниже — setTimeout(0) мог сработать
            // до коммита DOM (videoRef.current === null) и поток не подключался вовсе.
        } catch {
            // Камера недоступна (десктоп-webview/запрет) → нативный input capture,
            // на десктопе он сам деградирует в файловый диалог.
            cameraRef.current?.click();
        }
    }, [busy]);

    const snapPhoto = useCallback(async () => {
        const video = videoRef.current;
        if (!video || busy) return;
        // Гейт против чёрного кадра: пока кадров нет, videoWidth = 0 и drawImage
        // рисует пустоту — именно так в AI уезжал однотонный JPEG на 12 КБ.
        if (!video.videoWidth || !video.videoHeight) {
            setMsg('Камера ещё не дала картинку — подождите секунду и снимите снова.');
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { stopCamera(); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const b64 = canvas.toDataURL('image/jpeg', 0.9);
        stopCamera();
        await uploadB64(b64);
    }, [busy, stopCamera, uploadB64]);

    const doChoose = useCallback(async (index: number) => {
        if (busy) return;
        setBusy(true); setBusyLabel('choose:' + index); setMsg('');
        try {
            const s = await cardPhotoChoose(index);
            hapticNotification('success');
            setChosenUrl(s.url);
            apply(s);
        } catch (e: any) { fail(e, 'Не удалось выбрать'); }
        finally { setBusy(false); setBusyLabel(''); }
    }, [busy, apply, fail]);

    const doReroll = useCallback(async () => {
        if (busy) return;
        setBusy(true); setBusyLabel('reroll'); setMsg('');
        try {
            apply(await cardPhotoReroll());
            hapticNotification('success');
        } catch (e: any) { fail(e, 'Не удалось сгенерировать'); }
        finally { setBusy(false); setBusyLabel(''); }
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
    } else if (camOpen) {
        body = (
            <>
                <div className="cardflow-title">Улыбнись 📸</div>
                <video ref={videoRef} className="cardflow-preview cardflow-preview--live"
                    playsInline muted autoPlay />
                <button className="cube-btn-primary" disabled={busy || !camReady} onClick={snapPhoto}>
                    {busyLabel === 'upload' ? 'Загружаем…' : camReady ? '📸 Снять' : 'Готовим камеру…'}
                </button>
                <button className="cube-btn-sm" disabled={busy} onClick={stopCamera}>Отмена</button>
            </>
        );
    } else if (status === 'choosing' && state.variants.length > 0) {
        body = (
            <>
                <div className="cardflow-title">Выбери вариант</div>
                <div className="cardflow-variants">
                    {/* Оригинал рядом с вариантами (П.10): без него не с чем
                        сравнивать «похоже / не похоже». Кнопка под ним —
                        «оставить как есть» (Д7), доплаты нет. */}
                    {state.selfie_url && (
                        <div className="cardflow-variant cardflow-variant--origin">
                            <img src={state.selfie_url} alt="Оригинал" />
                            <div className="cardflow-variant-title">Оригинал</div>
                            <div className="cardflow-variant-hint">твоё фото без обработки</div>
                            <button className="cube-btn-sm" disabled={busy}
                                onClick={() => doChoose(KEEP_ORIGINAL_INDEX)}>
                                {busyLabel === 'choose:' + KEEP_ORIGINAL_INDEX ? '…' : 'Оставить как есть'}
                            </button>
                        </div>
                    )}
                    {state.variants.map((v, i) => {
                        const label = VARIANT_LABEL[state.variant_modes[i]];
                        return (
                            <div key={v} className="cardflow-variant">
                                <img src={v} alt={label?.title ?? `Вариант ${i + 1}`} />
                                <div className="cardflow-variant-title">
                                    {label?.title ?? `Вариант ${i + 1}`}
                                </div>
                                {label && <div className="cardflow-variant-hint">{label.hint}</div>}
                                <button className="cube-btn-sm" disabled={busy} onClick={() => doChoose(i)}>
                                    {busyLabel === 'choose:' + i ? '…' : 'Выбрать'}
                                </button>
                            </div>
                        );
                    })}
                </div>
                <button className="cube-btn-sm" disabled={busy} onClick={doReroll}>
                    {busyLabel === 'reroll'
                        ? 'Списываем…'
                        : rerollCredits > 0
                            ? `🎲 Ещё 2 варианта (бесплатно, осталось ${rerollCredits})`
                            : `🎲 Ещё 2 варианта (${rerollPrice} 💧)`}
                </button>
                {rerollCredits > 0 && (
                    <div className="cardflow-note">
                        Попытку подарил наставник — капли не спишутся, цена следующей платной смены не вырастет.
                    </div>
                )}
            </>
        );
    } else if (status === 'processing') {
        body = (
            <>
                <div className="cardflow-title">Обрабатываем…</div>
                <div className="cardflow-hint">AI готовит два варианта — слабую и глубокую обработку. Обычно до минуты, окно можно не закрывать.</div>
                <div className="shop-skeleton-card" style={{ height: 120 }} />
            </>
        );
    } else if (status === 'awaiting_photo' || status === 'failed') {
        // Режим уже оплачен — остался источник селфи.
        body = (
            <>
                <div className="cardflow-title">
                    {status === 'failed' ? 'Не получилось — попробуй ещё раз' : 'Откуда фото?'}
                </div>
                {busyLabel === 'upload' ? (
                    <div className="cardflow-hint">Загружаем фото…</div>
                ) : (
                    <>
                        <button className="cube-btn-primary" disabled={busy} onClick={openCamera}>
                            📸 Сделать фото
                        </button>
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={() => fileRef.current?.click()}>
                            🖼 Выбрать из галереи
                        </button>
                        <div className="cardflow-hint">
                            {mode === 'raw'
                                ? 'Фото не отправляется в AI и сразу станет карточкой.'
                                : 'AI сделает два варианта на выбор — слабую и глубокую обработку. Оригинал тоже покажем.'}
                        </div>
                    </>
                )}
            </>
        );
    } else {
        // Покупка: режим выбирается ДО оплаты (8c.1) — raw фикс, AI прогрессия.
        body = (
            <>
                <div className="cardflow-title">Своё фото на карточке</div>
                {state.url && (
                    <img className="cardflow-preview" src={state.url} alt="Текущая карточка" />
                )}
                <div className="cardflow-hint">
                    {state.url
                        ? 'Сейчас наставник видит это фото. Смена AI дорожает с каждым разом, «как есть» — фикс.'
                        : 'Пока наставник видит мультяшный образ. AI-обработка (слабая и глубокая на выбор) или «как есть» без AI.'}
                </div>
                <button className="cube-btn-primary" disabled={busy || balance < aiPrice}
                    onClick={() => doPurchase('ai')}>
                    {busyLabel === 'purchase:ai' ? 'Списываем…' : `✨ Обработать AI — ${aiPrice} 💧`}
                </button>
                <button className="cube-btn-sm" disabled={busy || balance < rawPrice}
                    onClick={() => doPurchase('raw')}>
                    {busyLabel === 'purchase:raw' ? 'Списываем…' : `📷 Как есть (без AI) — ${rawPrice} 💧`}
                </button>
                {balance < Math.min(aiPrice, rawPrice) && (
                    <div className="cardflow-hint">Недостаточно капель ({balance}/{Math.min(aiPrice, rawPrice)})</div>
                )}
            </>
        );
    }

    return (
        <div className="cardflow-backdrop" onClick={() => { if (!busy && !camOpen) onClose(); }}>
            <div className="cardflow-card" onClick={(e) => e.stopPropagation()}>
                {body}
                {msg && <div className="cardflow-msg">{msg}</div>}
                <button className="cardflow-close" onClick={() => { stopCamera(); onClose(); }}>Закрыть</button>
                <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={onFile}
                />
                {/* Мобильный шорткат съёмки (фолбэк, когда getUserMedia недоступен) */}
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

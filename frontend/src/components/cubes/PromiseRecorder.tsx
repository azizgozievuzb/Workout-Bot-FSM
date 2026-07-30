import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hapticImpact, hapticNotification } from '../../utils/haptic';

/* 8d (§8.8a): запись видео-обещания ≤30 сек с фронтальной камеры (MediaRecorder)
   + фолбэк «загрузить файл» для клиентов без getUserMedia/MediaRecorder.
   Дисклоз о хранении видео — строкой прямо на экране записи (решение S55).

   Хотфикс смоука 8d (шаг 2а, десктоп Telegram Web):
   * рендер через портал в document.body — шторка страницы игрока обрезала лист;
   * лист скроллится и ограничен по высоте, превью не выталкивает кнопки за экран;
   * тип блоба берётся из recorder.mimeType (наш guess врал → превью не игралось);
   * ошибки аплоада показываются ВНУТРИ рекордера, «Отмена» не блокируется. */

const MAX_SECONDS = 30;
const MAX_BYTES = 30 * 1024 * 1024;

interface Props {
    title: string;
    hint?: string;
    confirmLabel?: string;
    busy?: boolean;
    /** Текст ошибки от родителя (аплоад упал) — показываем поверх, не закрывая экран. */
    error?: string;
    /** Прогресс аплоада 0..100 */
    progress?: number | null;
    onReady: (blob: Blob) => void;
    onCancel: () => void;
}

/** Кандидаты в порядке предпочтения; undefined → пусть браузер решает сам. */
function pickMime(): string | undefined {
    const MR = (window as any).MediaRecorder;
    if (!MR?.isTypeSupported) return undefined;
    for (const m of [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
    ]) {
        if (MR.isTypeSupported(m)) return m;
    }
    return undefined;
}

const PromiseRecorder: React.FC<Props> = ({
    title, hint, confirmLabel = 'Отправить', busy = false, error, progress, onReady, onCancel,
}) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<any>(null);
    const chunksRef = useRef<BlobPart[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [phase, setPhase] = useState<'idle' | 'live' | 'recording' | 'preview'>('idle');
    const [seconds, setSeconds] = useState(0);
    const [blob, setBlob] = useState<Blob | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string>('');
    const [localError, setLocalError] = useState('');

    const stopStream = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        // Пока srcObject не снят, элемент игнорирует src → blob-превью не заиграет.
        if (videoRef.current) videoRef.current.srcObject = null;
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }, []);

    // Привязка живого потока строго после рендера live-фазы.
    useEffect(() => {
        if (phase !== 'live' && phase !== 'recording') return;
        const v = videoRef.current;
        const stream = streamRef.current;
        if (!v || !stream || v.srcObject === stream) return;
        v.srcObject = stream;
        v.muted = true;
        v.play().catch(() => { });
    }, [phase]);

    useEffect(() => () => {
        stopStream();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [stopStream, previewUrl]);

    const startCamera = useCallback(async () => {
        setLocalError('');
        if (!navigator.mediaDevices?.getUserMedia || !(window as any).MediaRecorder) {
            setLocalError('Камера недоступна в этом клиенте — загрузите файл ниже.');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' }, audio: true,
            });
            streamRef.current = stream;
            setPhase('live');
            // srcObject привязывается в useEffect ниже: rAF мог сработать до коммита
            // DOM (ref === null) → на iOS превью оставалось чёрным.
        } catch {
            setLocalError('Не удалось включить камеру — разрешите доступ или загрузите файл.');
        }
    }, []);

    const stopRecording = useCallback(() => {
        try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    }, []);

    const startRecording = useCallback(() => {
        const stream = streamRef.current;
        if (!stream) return;
        hapticImpact('medium');
        chunksRef.current = [];
        const wanted = pickMime();
        let rec: any;
        try {
            rec = new (window as any).MediaRecorder(stream, wanted ? { mimeType: wanted } : undefined);
        } catch {
            rec = new (window as any).MediaRecorder(stream);
        }
        recorderRef.current = rec;
        rec.ondataavailable = (e: any) => { if (e.data?.size) chunksRef.current.push(e.data); };
        rec.onerror = () => { setLocalError('Ошибка записи. Попробуйте ещё раз.'); setPhase('idle'); stopStream(); };
        rec.onstop = () => {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            // ВАЖНО: тип берём у рекордера, а не из своей догадки — иначе mp4 от Safari
            // получал ярлык webm и превью не воспроизводилось (находка смоука 8d).
            const actual: string = rec.mimeType || wanted || 'video/webm';
            const out = new Blob(chunksRef.current, { type: actual });
            stopStream();
            if (out.size === 0) { setLocalError('Запись не получилась, попробуйте ещё раз.'); setPhase('idle'); return; }
            setBlob(out);
            setPreviewUrl(URL.createObjectURL(out));
            setPhase('preview');
            hapticNotification('success');
        };
        rec.start(250);   // таймслайс: чанки копятся по ходу, а не одним куском в конце
        setSeconds(0);
        setPhase('recording');
        timerRef.current = setInterval(() => {
            setSeconds((s) => {
                if (s + 1 >= MAX_SECONDS) { stopRecording(); return MAX_SECONDS; }
                return s + 1;
            });
        }, 1000);
    }, [stopRecording, stopStream]);

    const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (f.size > MAX_BYTES) { setLocalError('Файл больше 30 МБ — снимите короче.'); return; }
        stopStream();
        setLocalError('');
        setBlob(f);
        setPreviewUrl(URL.createObjectURL(f));
        setPhase('preview');
    }, [stopStream]);

    const retake = useCallback(() => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(''); setBlob(null); setSeconds(0); setLocalError(''); setPhase('idle');
    }, [previewUrl]);

    const close = useCallback(() => { stopStream(); onCancel(); }, [stopStream, onCancel]);

    const shownError = error || localError;
    const sizeMb = blob ? (blob.size / 1024 / 1024).toFixed(1) : null;

    return createPortal(
        <div className="cube-modal-backdrop promise-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
            <div className="cube-modal-sheet promise-recorder" onClick={(e) => e.stopPropagation()}>
                <div className="cube-modal-handle" />
                <div className="cube-modal-title">{title}</div>
                {hint && <div className="cube-modal-subtitle">{hint}</div>}

                {shownError && <div className="cube-modal-error">{shownError}</div>}

                <div className="promise-video-box">
                    {/* key разводит live и preview в РАЗНЫЕ DOM-элементы: иначе React
                        переиспользует один <video>, а оставшийся на нём srcObject
                        (MediaStream) перебивает src=blob → чёрный кадр 0:00. */}
                    {phase === 'preview' && previewUrl ? (
                        <video key="preview" src={previewUrl} controls playsInline
                            className="promise-video" />
                    ) : (
                        <video key="live" ref={videoRef} playsInline muted
                            className="promise-video promise-video--live" />
                    )}
                    {phase === 'recording' && (
                        <div className="promise-rec-badge">● {seconds}/{MAX_SECONDS} с</div>
                    )}
                    {phase === 'idle' && !shownError && (
                        <div className="promise-video-placeholder">Камера выключена</div>
                    )}
                </div>

                {phase === 'preview' && sizeMb && (
                    <div className="promise-meta">Записано · {sizeMb} МБ · {blob?.type || 'video'}</div>
                )}
                {busy && progress != null && (
                    <div className="promise-meta">Загружаем… {progress}%</div>
                )}

                <div className="promise-disclosure">
                    Видео хранится на защищённом сервере, доступно только вам двоим по временной ссылке
                    и удаляется через 30 дней после отметки «Выполнено».
                </div>

                <div className="cube-modal-actions promise-actions">
                    {phase === 'idle' && (
                        <button className="cube-modal-btn cube-modal-btn--primary" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); startCamera(); }}>
                            🎥 Включить камеру
                        </button>
                    )}
                    {phase === 'live' && (
                        <button className="cube-modal-btn cube-modal-btn--primary" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); startRecording(); }}>
                            ● Записать (до {MAX_SECONDS} с)
                        </button>
                    )}
                    {phase === 'recording' && (
                        <button className="cube-modal-btn cube-modal-btn--primary"
                            onClick={(e) => { e.stopPropagation(); stopRecording(); }}>
                            ■ Стоп
                        </button>
                    )}
                    {phase === 'preview' && (
                        <>
                            <button className="cube-modal-btn cube-modal-btn--ghost" disabled={busy}
                                onClick={(e) => { e.stopPropagation(); retake(); }}>
                                Переснять
                            </button>
                            <button className="cube-modal-btn cube-modal-btn--primary" disabled={busy || !blob}
                                onClick={(e) => { e.stopPropagation(); if (blob) onReady(blob); }}>
                                {busy ? 'Отправляем…' : confirmLabel}
                            </button>
                        </>
                    )}
                </div>

                {phase !== 'preview' && (
                    <label className="promise-file-label">
                        🖼 Загрузить готовое видео
                        <input type="file" accept="video/*" style={{ display: 'none' }}
                            onChange={onFile} disabled={busy} />
                    </label>
                )}

                {/* «Отмена» никогда не блокируется — иначе при зависшем аплоаде
                    из экрана не выйти (находка смоука 8d). */}
                <button className="cube-modal-btn cube-modal-btn--ghost"
                    onClick={(e) => { e.stopPropagation(); close(); }}>
                    {busy ? 'Закрыть (загрузка прервётся)' : 'Отмена'}
                </button>
            </div>
        </div>,
        document.body,
    );
};

export default PromiseRecorder;

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { hapticImpact, hapticNotification } from '../../utils/haptic';

/* 8d (§8.8a): запись видео-обещания ≤30 сек с фронтальной камеры (MediaRecorder)
   + фолбэк «загрузить файл» для клиентов без getUserMedia/MediaRecorder.
   Дисклоз о хранении видео — строкой прямо на экране записи (решение S55). */

const MAX_SECONDS = 30;
const MAX_BYTES = 30 * 1024 * 1024;

interface Props {
    title: string;
    hint?: string;
    confirmLabel?: string;
    busy?: boolean;
    onReady: (blob: Blob) => void;
    onCancel: () => void;
}

function pickMime(): string | undefined {
    const MR = (window as any).MediaRecorder;
    if (!MR?.isTypeSupported) return undefined;
    for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']) {
        if (MR.isTypeSupported(m)) return m;
    }
    return undefined;
}

const PromiseRecorder: React.FC<Props> = ({
    title, hint, confirmLabel = 'Отправить', busy = false, onReady, onCancel,
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
    const [error, setError] = useState('');

    const stopStream = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }, []);

    useEffect(() => () => {
        stopStream();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [stopStream, previewUrl]);

    const startCamera = useCallback(async () => {
        setError('');
        if (!navigator.mediaDevices?.getUserMedia || !(window as any).MediaRecorder) {
            setError('Камера недоступна в этом клиенте — загрузите файл ниже.');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' }, audio: true,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.muted = true;
                await videoRef.current.play().catch(() => { });
            }
            setPhase('live');
        } catch {
            setError('Не удалось включить камеру — разрешите доступ или загрузите файл.');
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
        const mime = pickMime();
        const rec = new (window as any).MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        recorderRef.current = rec;
        rec.ondataavailable = (e: any) => { if (e.data?.size) chunksRef.current.push(e.data); };
        rec.onstop = () => {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            const out = new Blob(chunksRef.current, { type: mime || 'video/webm' });
            stopStream();
            if (out.size === 0) { setError('Запись не получилась, попробуйте ещё раз.'); setPhase('idle'); return; }
            setBlob(out);
            setPreviewUrl(URL.createObjectURL(out));
            setPhase('preview');
            hapticNotification('success');
        };
        rec.start();
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
        if (f.size > MAX_BYTES) { setError('Файл больше 30 МБ — снимите короче.'); return; }
        stopStream();
        setBlob(f);
        setPreviewUrl(URL.createObjectURL(f));
        setPhase('preview');
    }, [stopStream]);

    const retake = useCallback(() => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(''); setBlob(null); setSeconds(0); setPhase('idle');
    }, [previewUrl]);

    return (
        <div className="cube-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
            <div className="cube-modal-sheet promise-recorder" onClick={(e) => e.stopPropagation()}>
                <div className="cube-modal-handle" />
                <div className="cube-modal-title">{title}</div>
                {hint && <div className="cube-modal-subtitle">{hint}</div>}

                <div className="promise-video-box">
                    {phase === 'preview' && previewUrl ? (
                        <video src={previewUrl} controls playsInline className="promise-video" />
                    ) : (
                        <video ref={videoRef} playsInline muted className="promise-video" />
                    )}
                    {phase === 'recording' && (
                        <div className="promise-rec-badge">● {seconds}/{MAX_SECONDS} с</div>
                    )}
                </div>

                {error && <div className="cube-modal-error">{error}</div>}

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

                <button className="cube-modal-btn cube-modal-btn--ghost" disabled={busy}
                    onClick={(e) => { e.stopPropagation(); stopStream(); onCancel(); }}>
                    Отмена
                </button>
            </div>
        </div>
    );
};

export default PromiseRecorder;

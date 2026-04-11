import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import './PhotoGate.css';

type Phase = 'intro' | 'camera' | 'countdown' | 'preview' | 'uploading';

const COUNTDOWN_SEC = 3;
const OVAL_RATIO = 1.35;
const DETECTION_INTERVAL = 200;
const REQUIRED_STABLE = 5;

const PhotoGate: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('intro');
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const detectionLoop = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownLoop = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveRef = useRef(0);
  const phaseRef = useRef<Phase>('intro');
  const streamAttached = useRef(false);

  const { setPhotoUrl } = useAuthStore();

  phaseRef.current = phase;

  // --- Cleanup ---
  const cleanup = useCallback(() => {
    if (detectionLoop.current) { clearInterval(detectionLoop.current); detectionLoop.current = null; }
    if (countdownLoop.current) { clearInterval(countdownLoop.current); countdownLoop.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    streamAttached.current = false;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // --- Capture ---
  const doCapture = useCallback(() => {
    const video = videoElRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    const offsetX = (video.videoWidth - size) / 2;
    const offsetY = (video.videoHeight - size) / 2;
    ctx.drawImage(video, offsetX, offsetY, size, size, 0, 0, size, size);

    setCapturedImage(canvas.toDataURL('image/jpeg', 0.85));
    setPhase('preview');
    cleanup();
  }, [cleanup]);

  // --- Countdown ---
  const startCountdown = useCallback(() => {
    setPhase('countdown');
    let count = COUNTDOWN_SEC;
    setCountdown(count);
    countdownLoop.current = setInterval(() => {
      count--;
      setCountdown(count);
      if (count <= 0) {
        if (countdownLoop.current) { clearInterval(countdownLoop.current); countdownLoop.current = null; }
        doCapture();
      }
    }, 1000);
  }, [doCapture]);

  // --- Face detection ---
  const startDetection = useCallback(() => {
    if (detectionLoop.current) clearInterval(detectionLoop.current);
    consecutiveRef.current = 0;
    setFaceDetected(false);

    if (!detectorRef.current && 'FaceDetector' in window) {
      try { detectorRef.current = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 }); }
      catch { /* not supported */ }
    }

    detectionLoop.current = setInterval(async () => {
      const video = videoElRef.current;
      if (!video || video.readyState < 2) return;
      if (phaseRef.current !== 'camera') return;

      let hasFace = false;
      if (detectorRef.current) {
        try {
          const faces = await detectorRef.current.detect(video);
          if (faces.length > 0) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            const f = faces[0].boundingBox;
            const cx = f.x + f.width / 2;
            const cy = f.y + f.height / 2;
            hasFace = cx > vw * 0.3 && cx < vw * 0.7 && cy > vh * 0.2 && cy < vh * 0.65;
          }
        } catch { /* ignore */ }
      } else {
        hasFace = true;
      }

      if (hasFace) {
        consecutiveRef.current++;
        if (consecutiveRef.current >= REQUIRED_STABLE) {
          setFaceDetected(true);
          if (detectionLoop.current) { clearInterval(detectionLoop.current); detectionLoop.current = null; }
          startCountdown();
        }
      } else {
        consecutiveRef.current = Math.max(0, consecutiveRef.current - 2);
        setFaceDetected(false);
      }
    }, DETECTION_INTERVAL);
  }, [startCountdown]);

  // --- Attach stream to video element + start detection ---
  const attachStreamToVideo = useCallback(async (video: HTMLVideoElement) => {
    if (!streamRef.current || streamAttached.current) return;
    streamAttached.current = true;

    video.srcObject = streamRef.current;
    try { await video.play(); } catch { /* autoplay blocked */ }

    // Wait for actual frames
    if (video.readyState >= 2) {
      startDetection();
    } else {
      video.addEventListener('loadeddata', () => startDetection(), { once: true });
    }
  }, [startDetection]);

  // --- Video ref callback: fires when <video> mounts/unmounts ---
  const videoRefCallback = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current && !streamAttached.current) {
      attachStreamToVideo(el);
    }
  }, [attachStreamToVideo]);

  // --- Open camera ---
  const openCamera = useCallback(async () => {
    cleanup();
    setError(null);
    setFaceDetected(false);
    setCountdown(COUNTDOWN_SEC);
    consecutiveRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;

      // If video element already exists (retake case), attach immediately
      if (videoElRef.current) {
        setPhase('camera');
        attachStreamToVideo(videoElRef.current);
      } else {
        // Switch phase → video mounts → videoRefCallback fires → attaches stream
        setPhase('camera');
      }
    } catch {
      setError('Не удалось открыть камеру. Разрешите доступ в настройках.');
      setPhase('intro');
    }
  }, [cleanup, attachStreamToVideo]);

  // --- Retake ---
  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    openCamera();
  }, [openCamera]);

  // --- Upload ---
  const handleConfirm = useCallback(async () => {
    if (!capturedImage) return;
    setPhase('uploading');
    setError(null);
    try {
      const { data } = await api.post('/users/me/photo', { photo_base64: capturedImage });
      setPhotoUrl(data.profile_photo_url);
    } catch (err: any) {
      const detail = err.response?.data?.detail || err.message || 'Ошибка загрузки фото';
      setError(detail);
      setPhase('preview');
    }
  }, [capturedImage, setPhotoUrl]);

  return (
    <div className="pg-container">
      <AnimatePresence mode="wait">
        {/* --- INTRO --- */}
        {phase === 'intro' && (
          <motion.div
            key="intro"
            className="pg-card"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.3 }}
          >
            <div className="pg-icon">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <ellipse cx="40" cy="32" rx="18" ry="22" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeDasharray="6 4" />
                <circle cx="40" cy="60" r="14" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeDasharray="4 3" />
              </svg>
            </div>
            <h2 className="pg-title">Ваше лицо — фон приложения</h2>
            <p className="pg-subtitle">
              Сделайте селфи. Оно станет вашим персональным фоном в Mini App.
            </p>
            <div className="pg-warnings">
              <p className="pg-warning-item">Убедитесь, что освещение достаточно яркое — фото должно быть светлым и чётким</p>
              <p className="pg-warning-item pg-warning-item--accent">Фото делается один раз. Повторная замена будет платной</p>
            </div>
            {error && <p className="pg-error">{error}</p>}
            <button className="pg-btn pg-btn--primary" onClick={openCamera}>
              Открыть камеру
            </button>
          </motion.div>
        )}

        {/* --- CAMERA / COUNTDOWN --- */}
        {(phase === 'camera' || phase === 'countdown') && (
          <motion.div
            key="camera"
            className="pg-camera-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <video ref={videoRefCallback} className="pg-video" playsInline muted autoPlay />

            <div className="pg-oval-overlay">
              <svg className="pg-oval-svg" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <mask id="oval-mask">
                    <rect width="300" height="400" fill="white" />
                    <ellipse cx="150" cy="175" rx="95" ry={95 * OVAL_RATIO} fill="black" />
                  </mask>
                </defs>
                <rect width="300" height="400" fill="rgba(0,0,0,0.55)" mask="url(#oval-mask)" />
                <ellipse
                  cx="150" cy="175" rx="95" ry={95 * OVAL_RATIO}
                  fill="none"
                  stroke={faceDetected ? '#4ade80' : 'rgba(255,255,255,0.5)'}
                  strokeWidth="2.5"
                  className={faceDetected ? 'pg-oval-ring pg-oval-ring--active' : 'pg-oval-ring'}
                />
              </svg>
            </div>

            <div className="pg-camera-hint">
              {phase === 'countdown' ? (
                <motion.div
                  key={countdown}
                  className="pg-countdown"
                  initial={{ scale: 1.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  {countdown}
                </motion.div>
              ) : (
                <p className="pg-hint-text">Поместите лицо в овал</p>
              )}
            </div>
          </motion.div>
        )}

        {/* --- PREVIEW --- */}
        {phase === 'preview' && capturedImage && (
          <motion.div
            key="preview"
            className="pg-preview-view"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="pg-preview-frame">
              <img src={capturedImage} alt="Selfie" className="pg-preview-img" />
            </div>
            {error && <p className="pg-error">{error}</p>}
            <div className="pg-preview-buttons">
              <button className="pg-btn pg-btn--secondary" onClick={handleRetake}>Переснять</button>
              <button className="pg-btn pg-btn--primary" onClick={handleConfirm}>Подтвердить</button>
            </div>
          </motion.div>
        )}

        {/* --- UPLOADING --- */}
        {phase === 'uploading' && (
          <motion.div key="uploading" className="pg-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="pg-loading-spinner" />
            <p className="pg-subtitle">Сохраняем ваше фото...</p>
          </motion.div>
        )}
      </AnimatePresence>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export default PhotoGate;

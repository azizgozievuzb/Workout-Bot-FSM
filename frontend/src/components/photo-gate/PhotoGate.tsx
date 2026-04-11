import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import './PhotoGate.css';

type Phase = 'intro' | 'camera' | 'countdown' | 'preview' | 'uploading';

const COUNTDOWN_SEC = 3;
const OVAL_RATIO = 1.35;
const DETECTION_INTERVAL = 200; // ms
const REQUIRED_STABLE = 5; // ~1 сек стабильного обнаружения

const PhotoGate: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('intro');
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const detectionLoop = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownLoop = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveRef = useRef(0);
  const phaseRef = useRef<Phase>('intro');

  const { setPhotoUrl } = useAuthStore();

  // Sync phase to ref (avoid stale closures)
  phaseRef.current = phase;

  // --- Cleanup all intervals + camera ---
  const cleanup = useCallback(() => {
    if (detectionLoop.current) { clearInterval(detectionLoop.current); detectionLoop.current = null; }
    if (countdownLoop.current) { clearInterval(countdownLoop.current); countdownLoop.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // --- Capture photo (extracted to avoid closure issues) ---
  const doCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Mirror front camera
    ctx.translate(size, 0);
    ctx.scale(-1, 1);

    const offsetX = (video.videoWidth - size) / 2;
    const offsetY = (video.videoHeight - size) / 2;
    ctx.drawImage(video, offsetX, offsetY, size, size, 0, 0, size, size);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedImage(dataUrl);
    setPhase('preview');
    cleanup();
  }, [cleanup]);

  // --- Start camera + face detection ---
  const openCamera = useCallback(async () => {
    // Full reset
    cleanup();
    setError(null);
    setFaceDetected(false);
    setCountdown(COUNTDOWN_SEC);
    consecutiveRef.current = 0;
    setPhase('camera');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      // Wait for video to be actually playing before starting detection
      await new Promise<void>((resolve) => {
        const onPlaying = () => { video.removeEventListener('playing', onPlaying); resolve(); };
        video.addEventListener('playing', onPlaying);
        video.play().catch(() => resolve());
      });

      // Init FaceDetector if available
      if (!detectorRef.current && 'FaceDetector' in window) {
        try {
          detectorRef.current = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        } catch { /* not supported */ }
      }

      // --- Face detection loop ---
      detectionLoop.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        // Don't run detection if we're already in countdown/preview/etc
        if (phaseRef.current !== 'camera') return;

        let hasFace = false;

        if (detectorRef.current) {
          try {
            const faces = await detectorRef.current.detect(videoRef.current);
            if (faces.length > 0) {
              const vw = videoRef.current.videoWidth;
              const vh = videoRef.current.videoHeight;
              const face = faces[0].boundingBox;
              const cx = face.x + face.width / 2;
              const cy = face.y + face.height / 2;
              hasFace = cx > vw * 0.3 && cx < vw * 0.7 && cy > vh * 0.2 && cy < vh * 0.65;
            }
          } catch { hasFace = false; }
        } else {
          // No FaceDetector API → auto-pass after stabilization period
          hasFace = true;
        }

        if (hasFace) {
          consecutiveRef.current++;
          if (consecutiveRef.current >= REQUIRED_STABLE) {
            setFaceDetected(true);
            // Stop detection, start countdown
            if (detectionLoop.current) { clearInterval(detectionLoop.current); detectionLoop.current = null; }
            startCountdown();
          }
        } else {
          consecutiveRef.current = Math.max(0, consecutiveRef.current - 2);
          setFaceDetected(false);
        }
      }, DETECTION_INTERVAL);

    } catch {
      setError('Не удалось открыть камеру. Разрешите доступ в настройках.');
      setPhase('intro');
    }
  }, [cleanup]);

  // --- Countdown (separate function, no deps issues) ---
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
      const { data } = await api.post('/users/me/photo', {
        photo_base64: capturedImage,
      });
      setPhotoUrl(data.profile_photo_url);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Ошибка загрузки фото');
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
            transition={{ duration: 0.4 }}
          >
            <div className="pg-icon">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <ellipse cx="40" cy="32" rx="18" ry="22" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeDasharray="6 4" />
                <circle cx="40" cy="60" r="14" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeDasharray="4 3" />
              </svg>
            </div>
            <h2 className="pg-title">Ваше лицо — фон приложения</h2>
            <p className="pg-subtitle">
              Сделайте селфи. Оно станет персональным фоном Mini App — кубы будут летать поверх вашего лица.
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
          >
            <video
              ref={videoRef}
              className="pg-video"
              playsInline
              muted
              autoPlay
            />

            {/* Oval overlay */}
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
                  cx="150"
                  cy="175"
                  rx="95"
                  ry={95 * OVAL_RATIO}
                  fill="none"
                  stroke={faceDetected ? '#4ade80' : 'rgba(255,255,255,0.5)'}
                  strokeWidth="2.5"
                  className={faceDetected ? 'pg-oval-ring pg-oval-ring--active' : 'pg-oval-ring'}
                />
              </svg>
            </div>

            {/* Hint / Countdown */}
            <div className="pg-camera-hint">
              {phase === 'countdown' ? (
                <motion.div
                  key={countdown}
                  className="pg-countdown"
                  initial={{ scale: 1.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
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
              <button className="pg-btn pg-btn--secondary" onClick={handleRetake}>
                Переснять
              </button>
              <button className="pg-btn pg-btn--primary" onClick={handleConfirm}>
                Подтвердить
              </button>
            </div>
          </motion.div>
        )}

        {/* --- UPLOADING --- */}
        {phase === 'uploading' && (
          <motion.div
            key="uploading"
            className="pg-card"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
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

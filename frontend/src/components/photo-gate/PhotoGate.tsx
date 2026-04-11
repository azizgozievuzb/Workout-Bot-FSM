import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import './PhotoGate.css';

type Phase = 'intro' | 'camera' | 'countdown' | 'preview' | 'uploading';

const COUNTDOWN_SEC = 3;
const OVAL_RATIO = 1.35; // height / width for face oval

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
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { setPhotoUrl } = useAuthStore();

  // --- Cleanup ---
  const stopCamera = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // --- Start camera ---
  const startCamera = useCallback(async () => {
    setError(null);
    setPhase('camera');
    setFaceDetected(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Try to use native FaceDetector API
      if ('FaceDetector' in window) {
        try {
          detectorRef.current = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        } catch {
          detectorRef.current = null;
        }
      }

      // Start face detection loop
      startFaceDetection();
    } catch (err: any) {
      setError('Не удалось открыть камеру. Разрешите доступ в настройках.');
      setPhase('intro');
    }
  }, []);

  // --- Face detection ---
  const startFaceDetection = useCallback(() => {
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);

    let consecutiveDetections = 0;
    const REQUIRED_DETECTIONS = 5; // ~1 sec of stable detection at 200ms intervals

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;

      let hasFace = false;

      if (detectorRef.current) {
        // Native FaceDetector API
        try {
          const faces = await detectorRef.current.detect(videoRef.current);
          if (faces.length > 0) {
            // Check if face is roughly centered in oval area
            const vw = videoRef.current.videoWidth;
            const vh = videoRef.current.videoHeight;
            const face = faces[0].boundingBox;
            const cx = face.x + face.width / 2;
            const cy = face.y + face.height / 2;
            // Face center should be in middle 40% of frame
            hasFace = cx > vw * 0.3 && cx < vw * 0.7 && cy > vh * 0.2 && cy < vh * 0.65;
          }
        } catch { /* fallback below */ }
      } else {
        // Fallback: no face detection → auto-detect after 2 seconds of camera being on
        hasFace = true;
      }

      if (hasFace) {
        consecutiveDetections++;
        if (consecutiveDetections >= REQUIRED_DETECTIONS) {
          setFaceDetected(true);
        }
      } else {
        consecutiveDetections = Math.max(0, consecutiveDetections - 2);
        if (consecutiveDetections < REQUIRED_DETECTIONS - 2) {
          setFaceDetected(false);
        }
      }
    }, 200);
  }, []);

  // --- Start countdown when face detected ---
  useEffect(() => {
    if (phase === 'camera' && faceDetected) {
      setPhase('countdown');
      setCountdown(COUNTDOWN_SEC);

      let count = COUNTDOWN_SEC;
      countdownRef.current = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          capturePhoto();
        }
      }, 1000);
    }
  }, [faceDetected, phase]);

  // --- Reset countdown if face lost during countdown ---
  useEffect(() => {
    if (phase === 'countdown' && !faceDetected) {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setPhase('camera');
      setCountdown(COUNTDOWN_SEC);
    }
  }, [faceDetected, phase]);

  // --- Capture photo ---
  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const size = Math.min(video.videoWidth, video.videoHeight);

    // Crop to square centered on face area
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Mirror the image (front camera)
    ctx.translate(size, 0);
    ctx.scale(-1, 1);

    const offsetX = (video.videoWidth - size) / 2;
    const offsetY = (video.videoHeight - size) / 2;
    ctx.drawImage(video, offsetX, offsetY, size, size, 0, 0, size, size);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedImage(dataUrl);
    setPhase('preview');
    stopCamera();
  }, [stopCamera]);

  // --- Retake ---
  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    setFaceDetected(false);
    startCamera();
  }, [startCamera]);

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
            <button className="pg-btn pg-btn--primary" onClick={startCamera}>
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
            {/* Mirror CSS applied via .pg-video */}

            {/* Oval overlay */}
            <div className="pg-oval-overlay">
              <svg className="pg-oval-svg" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet">
                {/* Dark mask with oval cutout */}
                <defs>
                  <mask id="oval-mask">
                    <rect width="300" height="400" fill="white" />
                    <ellipse cx="150" cy="175" rx="95" ry={95 * OVAL_RATIO} fill="black" />
                  </mask>
                </defs>
                <rect width="300" height="400" fill="rgba(0,0,0,0.55)" mask="url(#oval-mask)" />
                {/* Oval border */}
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

            {/* Hint text */}
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

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export default PhotoGate;

/**
 * WorkoutScreen — 35-min training cycle UI.
 *
 * Responsibilities (separated by layer):
 *  - FSM logic → useWorkoutMachine (pure reducer, mirrors 200_workoutSessionMachine)
 *  - Hardware → useCameraRecorder (getUserMedia + MediaRecorder) + useWakeLock + usePhaseTimer
 *  - API      → api/workout.ts
 *  - UI       → this component, CSS only in WorkoutScreen.css
 *
 * Contract with FSM blueprint (1:1):
 *   idle → preparePhase(5s) → exercisingPhase(60s + record)
 *        → restAndAnalyzingPhase(30s + upload+analyze) → aiVerdictReview
 *        → (NEXT_EXERCISE) → preparePhase | finishSession
 *
 * Camera lifecycle: live ONLY during preparePhase + exercisingPhase.
 * Released on entry to restAndAnalyzingPhase, re-acquired on next preparePhase.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkoutMachine } from '../../fsm/workoutSessionMachine';
import {
  cancelWorkoutSession,
  finishWorkoutSession,
  getWorkoutConfig,
  startWorkoutSession,
  uploadWorkoutClip,
  type ClipResponse,
  type FinishSessionResponse,
  type WorkoutConfig,
} from '../../api/workout';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import './WorkoutScreen.css';

interface Props {
  onClose: () => void;
}

interface ErrState {
  message: string;
  retry?: () => void;
}

// --- WakeLock (no React context needed) -------------------------------
async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    if ('wakeLock' in navigator) {
      // @ts-expect-error — experimental
      return await navigator.wakeLock.request('screen');
    }
  } catch { /* ignored */ }
  return null;
}

const WorkoutScreen: React.FC<Props> = ({ onClose }) => {
  const { ctx, send } = useWorkoutMachine();
  const [config, setConfig] = useState<WorkoutConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phaseSecLeft, setPhaseSecLeft] = useState<number>(0);
  const [result, setResult] = useState<FinishSessionResponse | null>(null);
  const [errState, setErrState] = useState<ErrState | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // --- refs for imperative hardware --------------------------------
  const videoRef = useRef<HTMLVideoElement | null>(null);     // user camera (PiP)
  const demoVideoRef = useRef<HTMLVideoElement | null>(null); // exercise demo (main)
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const phaseTimerRef = useRef<number | null>(null);

  // --- load config + start session --------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, sess] = await Promise.all([getWorkoutConfig(), startWorkoutSession()]);
        if (cancelled) return;
        setConfig(cfg);
        setSessionId(sess.session_id);
      } catch (e) {
        if (cancelled) return;
        setErrState({ message: 'Не удалось начать сессию. Попробуйте позже.' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- hardware lifecycle -----------------------------------------
  const stopCamera = useCallback(() => {
    try { recorderRef.current?.state === 'recording' && recorderRef.current.stop(); } catch {}
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      try { videoRef.current.srcObject = null; } catch {}
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const wl = wakeLockRef.current;
    if (wl) { wl.release().catch(() => {}); wakeLockRef.current = null; }
  }, []);

  const initCamera = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      return true;
    } catch (e) {
      return false;
    }
  }, []);

  useEffect(() => {
    // acquire wakelock once, re-acquire on visibility change
    (async () => { wakeLockRef.current = await acquireWakeLock(); })();
    const onVis = async () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        wakeLockRef.current = await acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      releaseWakeLock();
      stopCamera();
      if (phaseTimerRef.current) { window.clearInterval(phaseTimerRef.current); phaseTimerRef.current = null; }
    };
  }, [releaseWakeLock, stopCamera]);

  // --- phase timer helper (count-down) ----------------------------
  const runPhaseTimer = useCallback((seconds: number, onEnd: () => void) => {
    if (phaseTimerRef.current) window.clearInterval(phaseTimerRef.current);
    setPhaseSecLeft(seconds);
    const tickMs = 250;
    let left = seconds * 1000;
    phaseTimerRef.current = window.setInterval(() => {
      left -= tickMs;
      send({ type: 'TICK', deltaMs: tickMs });
      if (left <= 0) {
        window.clearInterval(phaseTimerRef.current!);
        phaseTimerRef.current = null;
        setPhaseSecLeft(0);
        onEnd();
      } else {
        setPhaseSecLeft(Math.ceil(left / 1000));
      }
    }, tickMs);
  }, [send]);

  // --- recorder control -------------------------------------------
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mime = mimeCandidates.find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    try {
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1_500_000 } : undefined);
      rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start(1000);
      recorderRef.current = rec;
    } catch {
      // fallback: no recording; clip will be tiny
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return null;
    return new Promise<Blob | null>((resolve) => {
      rec.onstop = () => {
        const mime = rec.mimeType || 'video/webm';
        const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: mime }) : null;
        chunksRef.current = [];
        resolve(blob);
      };
      try { rec.stop(); } catch { resolve(null); }
    });
  }, []);

  // --- FSM transition drivers -------------------------------------
  const handlePrepareEnd = useCallback(() => {
    hapticImpact('medium');
    startRecording();
    send({ type: 'TIMER_END' });
  }, [send, startRecording]);

  const handleExerciseEnd = useCallback(async () => {
    hapticImpact('heavy');
    // BUG-3: stopRecording MUST complete before TIMER_END (which triggers stopCamera on rest entry).
    const blob = await stopRecording();
    send({ type: 'TIMER_END' });
    if (!sessionId) return;
    if (!blob) {
      send({ type: 'AI_ERROR' });
      return;
    }
    try {
      const verdict: ClipResponse = await uploadWorkoutClip(sessionId, ctx.currentExercise, blob);
      send({ type: 'AI_VERDICT', score: verdict.score, feedback: verdict.feedback });
    } catch {
      send({ type: 'AI_ERROR' });
    }
  }, [ctx.currentExercise, send, sessionId, stopRecording]);

  const handleRestEnd = useCallback(() => {
    hapticNotification('success');
    send({ type: 'TIMER_END' });
  }, [send]);

  // --- kickoff effect: when in a timed state, start the timer ------
  useEffect(() => {
    if (!config || !sessionId) return;
    let cancelled = false;
    if (ctx.state === 'preparePhase') {
      (async () => {
        // Re-acquire camera if it was released during rest (or first prepare after handleStart).
        if (!streamRef.current) {
          const ok = await initCamera();
          if (cancelled) return;
          if (!ok) {
            setErrState({
              message: 'Не удалось включить камеру. Закройте другие приложения и повторите.',
              retry: () => { setErrState(null); setRetryToken(t => t + 1); },
            });
            return;
          }
        }
        runPhaseTimer(config.prepare_sec, handlePrepareEnd);
      })();
    } else if (ctx.state === 'exercisingPhase') {
      runPhaseTimer(config.exercise_sec, handleExerciseEnd);
    } else if (ctx.state === 'restAndAnalyzingPhase') {
      // BUG-3: release camera fully during rest — LED off, no MediaStream live.
      stopCamera();
      runPhaseTimer(config.rest_sec, handleRestEnd);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.state, config, sessionId, retryToken]);

  // --- first start --------------------------------------------------
  const handleStart = useCallback(async () => {
    if (!config || !sessionId) return;
    const ok = await initCamera();
    if (!ok) {
      setErrState({
        message: 'Нет доступа к камере. Откройте приложение заново и разрешите камеру.',
        retry: () => { setErrState(null); /* user re-clicks Начать */ },
      });
      return;
    }
    hapticImpact('medium');
    send({ type: 'START_WORKOUT' });
  }, [config, initCamera, send, sessionId]);

  const handleNext = useCallback(() => {
    hapticImpact('light');
    send({ type: 'NEXT_EXERCISE' });
  }, [send]);

  // BUG-2 fix: auto-advance through aiVerdictReview — no popup, no tap.
  // Keep a brief beat (review_sec from config, default 1.5s) so haptic + state settle,
  // then transition straight into the next preparePhase / finishSession.
  useEffect(() => {
    if (ctx.state !== 'aiVerdictReview') return;
    const ms = Math.max(800, (config?.review_sec ?? 1.5) * 1000);
    const t = window.setTimeout(() => { handleNext(); }, ms);
    return () => window.clearTimeout(t);
  }, [ctx.state, config?.review_sec, handleNext]);

  // --- finish -------------------------------------------------------
  useEffect(() => {
    if (ctx.state !== 'finishSession' || !sessionId || result) return;
    (async () => {
      try {
        const r = await finishWorkoutSession(sessionId);
        setResult(r);
        hapticNotification('success');
      } catch { /* silent */ }
      stopCamera();
      releaseWakeLock();
    })();
  }, [ctx.state, sessionId, result, stopCamera, releaseWakeLock]);

  const handleClose = useCallback(async () => {
    hapticImpact('light');
    try { if (sessionId && ctx.state !== 'finishSession') await cancelWorkoutSession(sessionId); } catch {}
    stopCamera();
    releaseWakeLock();
    onClose();
  }, [ctx.state, onClose, releaseWakeLock, sessionId, stopCamera]);

  // --- Derived UI data ---------------------------------------------
  const currentExercise = useMemo(
    () => (config ? config.exercises[ctx.currentExercise] : null),
    [config, ctx.currentExercise],
  );

  const progressPct = config
    ? Math.round(((ctx.currentExercise + (ctx.state === 'finishSession' ? 1 : 0)) / config.total_exercises) * 100)
    : 0;

  // --- Render -------------------------------------------------------
  if (errState) {
    return (
      <div className="ws-root">
        <div className="ws-error-card">
          <div className="ws-error-title">Ошибка</div>
          <div className="ws-error-text">{errState.message}</div>
          {errState.retry && (
            <button className="ws-btn ws-btn--primary" onClick={errState.retry}>Повторить</button>
          )}
          <button className="ws-btn ws-btn--secondary" onClick={handleClose}>Завершить</button>
        </div>
      </div>
    );
  }

  if (!config || !sessionId) {
    return (
      <div className="ws-root">
        <div className="ws-loading">Подготовка сессии…</div>
      </div>
    );
  }

  // Demo + own-camera PiP only during prepare/exercise — released during rest (BUG-3).
  const showDemoAndCam =
    ctx.state === 'preparePhase' || ctx.state === 'exercisingPhase';

  const inActivePhase =
    ctx.state === 'preparePhase' ||
    ctx.state === 'exercisingPhase' ||
    ctx.state === 'restAndAnalyzingPhase' ||
    ctx.state === 'aiVerdictReview';

  return (
    <div className="ws-root">
      {/* MAIN: pre-recorded exercise demo video with built-in music + voice cues.
          Not muted — user gesture (handleStart) unlocks audio for the session. */}
      {currentExercise && showDemoAndCam && (
        <video
          ref={demoVideoRef}
          key={currentExercise.key}
          className="ws-demo-video"
          src={`/demos/${currentExercise.key}.mp4`}
          autoPlay
          loop
          playsInline
          preload="auto"
        />
      )}

      {/* PiP: user's own camera, small corner overlay — hidden when camera is released */}
      <video
        ref={videoRef}
        className={`ws-cam-pip ${showDemoAndCam ? '' : 'ws-cam-pip--off'}`}
        playsInline
        muted
      />

      {showDemoAndCam && <div className="ws-scrim" />}

      {/* --- top bar --- */}
      <div className="ws-topbar">
        <button className="ws-close" onClick={handleClose} aria-label="Закрыть">×</button>
        <div className="ws-progress">
          <div className="ws-progress-bar" style={{ width: `${progressPct}%` }} />
          <span className="ws-progress-text">
            {Math.min(ctx.currentExercise + 1, config.total_exercises)} / {config.total_exercises}
          </span>
        </div>
      </div>

      {/* --- state-specific body --- */}
      {ctx.state === 'idle' && (
        <div className="ws-center-card">
          <div className="ws-title">Готовы?</div>
          <div className="ws-subtitle">
            {config.total_exercises} упражнений · ~35 минут.<br />
            Поставьте телефон горизонтально, камера должна видеть вас полностью.
          </div>
          <button className="ws-btn ws-btn--primary" onClick={handleStart}>Начать</button>
        </div>
      )}

      {/* HUD: phase badge + countdown (top-right area).
          Active phases incl. aiVerdictReview — keeps flow continuous, no popup. */}
      {inActivePhase && currentExercise && (
        <div className="ws-hud">
          <div className={`ws-phase-badge ws-phase-${ctx.state}`}>
            {ctx.state === 'preparePhase' && 'Приготовьтесь'}
            {ctx.state === 'exercisingPhase' && 'Выполняйте'}
            {ctx.state === 'restAndAnalyzingPhase' && 'Отдых'}
            {ctx.state === 'aiVerdictReview' && 'Дальше…'}
          </div>
          {ctx.state !== 'aiVerdictReview' && (
            <div className="ws-countdown">{phaseSecLeft}</div>
          )}
          {ctx.state === 'exercisingPhase' && <div className="ws-rec-dot" aria-label="Запись" />}
        </div>
      )}

      {/* Bottom name overlay — appears whenever an exercise is on screen */}
      {inActivePhase && currentExercise && (
        <div className="ws-name-overlay">
          <div className="ws-name-overlay__name">{currentExercise.name}</div>
          {currentExercise.hint && (
            <div className="ws-name-overlay__hint">{currentExercise.hint}</div>
          )}
        </div>
      )}

      {ctx.state === 'finishSession' && (
        <div className="ws-center-card">
          <div className="ws-title">Готово 🎉</div>
          {result ? (
            <>
              <div className="ws-result-row"><span>Средняя оценка</span><span className="ws-result-val">{result.avg_score}%</span></div>
              <div className="ws-result-row"><span>Звёзды</span><span className="ws-result-val">⭐ {result.stars_earned}</span></div>
            </>
          ) : (
            <div className="ws-loading ws-loading--inline">Сохраняем результат…</div>
          )}
          <button className="ws-btn ws-btn--primary" onClick={onClose}>Закрыть</button>
        </div>
      )}
    </div>
  );
};

export default WorkoutScreen;

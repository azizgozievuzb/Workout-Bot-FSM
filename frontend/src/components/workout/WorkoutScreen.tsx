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

// BUG-5: Telegram WebApp accessor — every method optional-chained because
// older clients silently lack newer APIs (requestFullscreen/disableVerticalSwipes
// are Bot API 8.0+, BackButton/showConfirm are 6.1+).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tgWeb = (): any => (typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : null);

const WorkoutScreen: React.FC<Props> = ({ onClose }) => {
  const { ctx, send } = useWorkoutMachine();
  const [config, setConfig] = useState<WorkoutConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phaseSecLeft, setPhaseSecLeft] = useState<number>(0);
  const [result, setResult] = useState<FinishSessionResponse | null>(null);
  const [errState, setErrState] = useState<ErrState | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showSwipeWarning, setShowSwipeWarning] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [diagInfo, setDiagInfo] = useState<any>(null);

  // BUG-5: stable BackButton handler — Telegram requires identity match for offClick
  const closeWithConfirmRef = useRef<() => void>(() => {});
  const stableBackHandlerRef = useRef<() => void>(() => closeWithConfirmRef.current?.());

  // --- refs for imperative hardware --------------------------------
  const videoElRef = useRef<HTMLVideoElement | null>(null);   // user camera (top 60%)
  const demoVideoRef = useRef<HTMLVideoElement | null>(null); // exercise demo (bottom 40%)
  const streamRef = useRef<MediaStream | null>(null);

  // BUG-A: callback ref binds stream to <video> at mount time, regardless of
  // whether stream was acquired before or after the element appeared. Fixes
  // the regression where initCamera() ran before the conditional <video> mounted.
  const camCallbackRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current) {
      try { el.srcObject = streamRef.current; } catch {}
      el.play().catch(() => {});
    }
  }, []);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const phaseTimerRef = useRef<number | null>(null);
  // BUG-4: wall-clock timer — survives setInterval throttling when tab is hidden
  const phaseEndsAtRef = useRef<number | null>(null);
  const phaseStartedAtRef = useRef<number | null>(null);
  const currentOnEndRef = useRef<(() => void) | null>(null);

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
    if (videoElRef.current) {
      try { videoElRef.current.srcObject = null; } catch {}
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const wl = wakeLockRef.current;
    if (wl) { wl.release().catch(() => {}); wakeLockRef.current = null; }
  }, []);

  // BUG-5/C: lock Telegram chrome so swipe-down / swipe-back / × cannot kill the
  // workout silently. Each call is try/catch — older clients lack these methods.
  const lockTelegramChrome = useCallback(() => {
    const w = tgWeb(); if (!w) return;
    const diag = {
      version: w?.version,
      platform: w?.platform,
      hasRequestFullscreen: typeof w?.requestFullscreen === 'function',
      hasDisableVerticalSwipes: typeof w?.disableVerticalSwipes === 'function',
      hasSwipeBehavior: !!w?.SwipeBehavior,
      isExpanded: w?.isExpanded,
      isFullscreen: w?.isFullscreen,
    };
    console.log('[workout][TG-DIAG]', diag);
    setDiagInfo(diag);
    try { w.expand?.(); } catch (e) { console.warn('[workout] expand failed:', e); }
    try {
      if (typeof w.requestFullscreen === 'function') {
        w.requestFullscreen();
        console.info('[workout] requestFullscreen called');
      } else {
        console.warn('[workout] requestFullscreen unavailable — trying postEvent fallback');
        try { w.postEvent?.('web_app_request_fullscreen', false, {}); } catch {}
      }
    } catch (e) {
      console.warn('[workout] requestFullscreen failed:', e);
      try { w.postEvent?.('web_app_request_fullscreen', false, {}); } catch {}
    }
    try { w.disableVerticalSwipes?.(); } catch {}
    try { w.disableSwipeBack?.(); } catch {}
    try { w.SwipeBehavior?.disable?.(); } catch {}
    try { w.enableClosingConfirmation?.(); } catch {}
    try { w.MainButton?.hide?.(); } catch {}
    try { w.BackButton?.show?.(); } catch {}
    try { w.BackButton?.onClick?.(stableBackHandlerRef.current); } catch {}
  }, []);

  const unlockTelegramChrome = useCallback(() => {
    const w = tgWeb(); if (!w) return;
    try { w.exitFullscreen?.(); } catch {}
    try { w.enableVerticalSwipes?.(); } catch {}
    try { w.disableClosingConfirmation?.(); } catch {}
    try { w.BackButton?.offClick?.(stableBackHandlerRef.current); } catch {}
    try { w.BackButton?.hide?.(); } catch {}
  }, []);

  const initCamera = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      // BUG-A: bind to <video> if it's already mounted (callback ref already fired
      // before stream was acquired). Otherwise camCallbackRef will bind on mount.
      const el = videoElRef.current;
      if (el) {
        try { el.srcObject = stream; } catch {}
        el.play().catch(() => {});
      }
      return true;
    } catch (e) {
      return false;
    }
  }, []);

  // BUG-4: reconcile timer + demo position after returning from background.
  // Browsers throttle setInterval to ~1Hz when tab is hidden; iOS may pause
  // <video> entirely. Wall-clock comparison + explicit demo currentTime fixes both.
  const reconcileAfterVisible = useCallback(() => {
    const endsAt = phaseEndsAtRef.current;
    if (endsAt == null) return;
    const now = Date.now();
    if (now >= endsAt) {
      // Timer should have already fired — invoke onEnd manually
      if (phaseTimerRef.current) window.clearInterval(phaseTimerRef.current);
      phaseTimerRef.current = null;
      phaseEndsAtRef.current = null;
      phaseStartedAtRef.current = null;
      const fn = currentOnEndRef.current;
      currentOnEndRef.current = null;
      setPhaseSecLeft(0);
      fn?.();
      return;
    }
    setPhaseSecLeft(Math.ceil((endsAt - now) / 1000));
    // Re-arm interval if browser killed it
    if (!phaseTimerRef.current) {
      const tick = () => {
        const endsAtNow = phaseEndsAtRef.current;
        if (endsAtNow == null) return;
        const left = endsAtNow - Date.now();
        if (left <= 0) {
          if (phaseTimerRef.current) window.clearInterval(phaseTimerRef.current);
          phaseTimerRef.current = null;
          phaseEndsAtRef.current = null;
          phaseStartedAtRef.current = null;
          const fn = currentOnEndRef.current;
          currentOnEndRef.current = null;
          setPhaseSecLeft(0);
          fn?.();
          return;
        }
        setPhaseSecLeft(Math.ceil(left / 1000));
      };
      phaseTimerRef.current = window.setInterval(tick, 250);
    }
    // Resync demo video to the position it would be at if it had played continuously.
    const demo = demoVideoRef.current;
    const startedAt = phaseStartedAtRef.current;
    if (demo && startedAt != null) {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const dur = demo.duration;
      if (Number.isFinite(dur) && dur > 0) {
        try { demo.currentTime = elapsedSec % dur; } catch {}
      }
      demo.play().catch(() => {});
    }
  }, []);

  // BUG-D: while WorkoutScreen is mounted, gate native gestures via CSS
  // (overflow:fixed + touch-action:none on html/body).
  useEffect(() => {
    document.documentElement.classList.add('workout-active');
    document.body.classList.add('workout-active');
    return () => {
      document.documentElement.classList.remove('workout-active');
      document.body.classList.remove('workout-active');
    };
  }, []);

  // BUG-D: 40px edge-swipe interceptor — only during active phases.
  // Skipped in idle/finishSession so taps near the edges (Начать/Закрыть, modal
  // buttons) work. Note: iOS Telegram horizontal pager-swipe cannot be fully
  // blocked from JS — the system jest fires before touchstart. This is a best-effort.
  useEffect(() => {
    if (ctx.state === 'idle' || ctx.state === 'finishSession') return;
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0] || e.changedTouches[0];
      if (!t) return;
      // Whitelist: never intercept taps on topbar / progress / finish-btn —
      // their hit-targets sit inside the 40px edge zone.
      const target = e.target as Element | null;
      if (target?.closest?.('.ws-topbar, .ws-progress-rail, .ws-finish-btn')) {
        return;
      }
      const x = t.clientX;
      const w = window.innerWidth;
      if (x < 40 || x > w - 40) {
        try { e.preventDefault(); } catch {}
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('touchstart', onTouch, { passive: false, capture: true });
    window.addEventListener('touchmove', onTouch, { passive: false, capture: true });
    window.addEventListener('touchend', onTouch, { passive: false, capture: true });
    return () => {
      window.removeEventListener('touchstart', onTouch, true);
      window.removeEventListener('touchmove', onTouch, true);
      window.removeEventListener('touchend', onTouch, true);
    };
  }, [ctx.state]);

  // Mount-time arsenal: swipe locks ASAP. NOTE: requestFullscreen is intentionally
  // NOT called here — Safari prefers a user-gesture trigger, and a second call
  // from handleConfirmStart would fail with ALREADY_FULLSCREEN. Fullscreen is
  // requested only from the user-gesture path inside lockTelegramChrome().
  useEffect(() => {
    const w = tgWeb(); if (!w) return;
    try { w.expand?.(); } catch {}
    try { w.disableVerticalSwipes?.(); } catch {}
    try { w.enableClosingConfirmation?.(); } catch {}
    try { w.SwipeBehavior?.disable?.(); } catch {}
    try { w.disableSwipeBack?.(); } catch {}
  }, []);

  // Subscribe to fullscreenChanged / fullscreenFailed for live diagnostics.
  useEffect(() => {
    const w = tgWeb();
    if (!w?.onEvent) return;
    const onChg = () => setDiagInfo((d: typeof diagInfo) => d ? { ...d, isFullscreen: w.isFullscreen } : d);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onFail = (e: any) => {
      // ALREADY_FULLSCREEN is benign — a duplicate request when we're already in FS.
      if (e?.error === 'ALREADY_FULLSCREEN') return;
      console.warn('[workout] fullscreenFailed', e);
      setDiagInfo((d: typeof diagInfo) => d ? { ...d, fullscreenFailed: e?.error || 'unknown' } : d);
    };
    try { w.onEvent('fullscreenChanged', onChg); } catch {}
    try { w.onEvent('fullscreenFailed', onFail); } catch {}
    return () => {
      try { w.offEvent?.('fullscreenChanged', onChg); } catch {}
      try { w.offEvent?.('fullscreenFailed', onFail); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // acquire wakelock once, re-acquire on visibility change
    (async () => { wakeLockRef.current = await acquireWakeLock(); })();
    const onVis = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!wakeLockRef.current) {
        wakeLockRef.current = await acquireWakeLock();
      }
      reconcileAfterVisible();
    };
    const onPageShow = () => { reconcileAfterVisible(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onPageShow);
      releaseWakeLock();
      stopCamera();
      if (phaseTimerRef.current) { window.clearInterval(phaseTimerRef.current); phaseTimerRef.current = null; }
      phaseEndsAtRef.current = null;
      phaseStartedAtRef.current = null;
      currentOnEndRef.current = null;
    };
  }, [releaseWakeLock, stopCamera, reconcileAfterVisible]);

  // --- phase timer helper (wall-clock count-down) -----------------
  // Uses absolute end-timestamp instead of decrementing local counter so that
  // setInterval throttling / pausing in background tabs cannot drift the clock.
  const runPhaseTimer = useCallback((seconds: number, onEnd: () => void) => {
    if (phaseTimerRef.current) window.clearInterval(phaseTimerRef.current);
    const startedAt = Date.now();
    const endsAt = startedAt + seconds * 1000;
    phaseStartedAtRef.current = startedAt;
    phaseEndsAtRef.current = endsAt;
    currentOnEndRef.current = onEnd;
    const tick = () => {
      const left = endsAt - Date.now();
      if (left <= 0) {
        if (phaseTimerRef.current) window.clearInterval(phaseTimerRef.current);
        phaseTimerRef.current = null;
        phaseEndsAtRef.current = null;
        phaseStartedAtRef.current = null;
        currentOnEndRef.current = null;
        setPhaseSecLeft(0);
        onEnd();
        return;
      }
      setPhaseSecLeft(Math.ceil(left / 1000));
      send({ type: 'TICK', deltaMs: 250 });
    };
    tick();
    phaseTimerRef.current = window.setInterval(tick, 250);
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
  // handleStart only opens the swipe-warning modal. Camera/lock/dispatch happen
  // in handleConfirmStart so the user gesture comes AFTER reading the warning.
  const handleStart = useCallback(() => {
    if (!config || !sessionId) return;
    setShowSwipeWarning(true);
  }, [config, sessionId]);

  const handleConfirmStart = useCallback(async () => {
    setShowSwipeWarning(false);
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
    // BUG-5: lock Telegram chrome AFTER user gesture so swipe/× can't kill the workout.
    lockTelegramChrome();
    send({ type: 'START_WORKOUT' });
  }, [config, initCamera, lockTelegramChrome, send, sessionId]);

  const handleNext = useCallback(() => {
    hapticImpact('light');
    send({ type: 'NEXT_EXERCISE' });
  }, [send]);

  // Early camera init during rest — kicks off ~5s before the next preparePhase
  // so the stream is already live when the split layout mounts. Eliminates the
  // visible "gap" between rest end and demo+camera appearing.
  useEffect(() => {
    if (ctx.state !== 'restAndAnalyzingPhase') return;
    if (!config) return;
    const earlyInitMs = Math.max(0, (config.rest_sec - 5) * 1000);
    const t = window.setTimeout(() => {
      if (!streamRef.current) {
        initCamera().catch(() => {});
      }
    }, earlyInitMs);
    return () => window.clearTimeout(t);
  }, [ctx.state, config, initCamera]);

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
      unlockTelegramChrome();
    })();
  }, [ctx.state, sessionId, result, stopCamera, releaseWakeLock, unlockTelegramChrome]);

  const handleClose = useCallback(async () => {
    hapticImpact('light');
    unlockTelegramChrome();
    try { if (sessionId && ctx.state !== 'finishSession') await cancelWorkoutSession(sessionId); } catch {}
    stopCamera();
    releaseWakeLock();
    onClose();
  }, [ctx.state, onClose, releaseWakeLock, sessionId, stopCamera, unlockTelegramChrome]);

  // BUG-5: confirm before destroying an in-flight workout. Prefer Telegram's
  // native showConfirm; fall back to a React modal on older clients.
  const handleCloseWithConfirm = useCallback(() => {
    if (ctx.state === 'idle' || ctx.state === 'finishSession') {
      handleClose();
      return;
    }
    const w = tgWeb();
    if (w?.showConfirm) {
      try {
        w.showConfirm('Завершить тренировку? Прогресс будет потерян.', (ok: boolean) => {
          if (ok) handleClose();
        });
        return;
      } catch { /* fall through to modal */ }
    }
    setShowCloseConfirm(true);
  }, [ctx.state, handleClose]);

  // Keep the BackButton handler ref pointed at the latest closure
  useEffect(() => {
    closeWithConfirmRef.current = handleCloseWithConfirm;
  }, [handleCloseWithConfirm]);

  // Safety net — if component unmounts mid-workout, release Telegram chrome too
  useEffect(() => () => { unlockTelegramChrome(); }, [unlockTelegramChrome]);

  // --- Derived UI data ---------------------------------------------
  const currentExercise = useMemo(
    () => (config ? config.exercises[ctx.currentExercise] : null),
    [config, ctx.currentExercise],
  );

  const nextExercise = useMemo(
    () => (config ? config.exercises[ctx.currentExercise + 1] ?? null : null),
    [config, ctx.currentExercise],
  );

  // BUG-E: per-segment fill ratios (exercise portion + rest portion) for the
  // 16-segment progress rail. Each segment maps to one exercise; status is
  // 'done' / 'future' / current ctx.state.
  const segments = useMemo(() => {
    if (!config) return [];
    return Array.from({ length: config.total_exercises }).map((_, i) => {
      const status: string =
        i < ctx.currentExercise ? 'done'
        : i > ctx.currentExercise ? 'future'
        : ctx.state;

      const exerciseFill =
        status === 'done' ? 1
        : status === 'exercisingPhase' ? Math.max(0, 1 - phaseSecLeft / config.exercise_sec)
        : status === 'preparePhase' ? 0
        : status === 'restAndAnalyzingPhase' || status === 'aiVerdictReview' ? 1
        : status === 'finishSession' ? 1
        : 0;
      const restFill =
        status === 'done' ? 1
        : status === 'restAndAnalyzingPhase' ? Math.max(0, 1 - phaseSecLeft / config.rest_sec)
        : status === 'aiVerdictReview' ? 1
        : status === 'finishSession' ? 1
        : 0;
      return { status, exerciseFill, restFill };
    });
  }, [config, ctx.currentExercise, ctx.state, phaseSecLeft]);

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

  // Rest screen takes over for both rest+analyze and the brief verdict review.
  const restPhase =
    ctx.state === 'restAndAnalyzingPhase' || ctx.state === 'aiVerdictReview';

  return (
    <div className="ws-root">
      {/* --- top bar + progress rail: hidden in idle (no workout in flight there;
            Telegram's native «Закрыть» is enough). --- */}
      {ctx.state !== 'idle' && (
        <>
          <div className="ws-topbar">
            <button
              className="ws-finish-btn"
              onClick={handleCloseWithConfirm}
              aria-label="Завершить тренировку"
            >
              Завершить
            </button>
            <div className="ws-progress-label">
              {Math.min(ctx.currentExercise + 1, config.total_exercises)} / {config.total_exercises}
            </div>
          </div>

          <div className="ws-progress-rail">
            {segments.map((seg, i) => (
              <div key={i} className={`ws-seg ws-seg--${seg.status}`}>
                <div className="ws-seg__ex" style={{ transform: `scaleX(${seg.exerciseFill})` }} />
                <div className="ws-seg__rest" style={{ transform: `scaleX(${seg.restFill})` }} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* --- split layout (top 60% camera / bottom 40% demo) — only during prepare/exercise --- */}
      {showDemoAndCam && (
        <div className="ws-stage">
          <div className="ws-cam-top">
            <video
              ref={camCallbackRef}
              playsInline
              muted
              autoPlay
            />

            {/* HUD: phase badge + countdown + REC dot — top-right of camera */}
            {currentExercise && (
              <div className="ws-hud">
                <div className={`ws-phase-badge ws-phase-${ctx.state}`}>
                  {ctx.state === 'preparePhase' ? 'Приготовьтесь' : 'Выполняйте'}
                </div>
                <div className="ws-countdown">{phaseSecLeft}</div>
                {ctx.state === 'exercisingPhase' && <div className="ws-rec-dot" aria-label="Запись" />}
              </div>
            )}
          </div>

          <div className="ws-demo-bottom">
            {currentExercise && (
              <video
                ref={demoVideoRef}
                key={currentExercise.key}
                src={`/demos/${currentExercise.key}.mp4`}
                autoPlay
                loop
                playsInline
                preload="auto"
              />
            )}

            {/* Exercise name overlay — pinned to bottom of demo */}
            {currentExercise && (
              <div className="ws-name-overlay">
                <div className="ws-name-overlay__name">{currentExercise.name}</div>
                {currentExercise.hint && (
                  <div className="ws-name-overlay__hint">{currentExercise.hint}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Diagnostic overlay — DEV builds only. Tap to dismiss. */}
      {import.meta.env.DEV && diagInfo && (
        <div className="ws-diag" onClick={() => setDiagInfo(null)}>
          v:{String(diagInfo.version)} · {String(diagInfo.platform)} ·
          {' '}FS:{String(diagInfo.hasRequestFullscreen)} ·
          {' '}isFS:{String(diagInfo.isFullscreen)} ·
          {' '}SB:{String(diagInfo.hasSwipeBehavior)}
          {diagInfo.fullscreenFailed && ` · FAIL:${diagInfo.fullscreenFailed}`}
        </div>
      )}

      {/* --- state-specific body --- */}
      {ctx.state === 'idle' && (
        <div className="ws-idle-wrap">
          <div className="ws-center-card">
            <div className="ws-title">Готовы?</div>
            <div className="ws-subtitle">
              {config.total_exercises} упражнений · ~{Math.round((config.total_exercises * (config.prepare_sec + config.exercise_sec + config.rest_sec + config.review_sec)) / 60)} минут.<br />
              Поставьте телефон вертикально, камера должна видеть вас полностью.
            </div>
            <button className="ws-btn ws-btn--primary" onClick={handleStart}>Начать</button>
          </div>
        </div>
      )}

      {/* Rest screen — black background, big countdown, next-exercise card.
          Replaces split layout for restAndAnalyzingPhase + aiVerdictReview.
          NOTE: mid-workout AI score/feedback intentionally hidden — shown only on finish. */}
      {restPhase && (
        <div className="ws-rest-root">
          <div className="ws-rest-countdown">
            {ctx.state === 'restAndAnalyzingPhase' ? phaseSecLeft : '·'}
          </div>
          {nextExercise ? (
            <div className="ws-rest-next">
              <div className="ws-rest-next__name">Дальше: {nextExercise.name}</div>
              <div className="ws-rest-next__position">Положение: {nextExercise.position}</div>
              {nextExercise.muscles.length > 0 && (
                <div className="ws-rest-next__muscles">
                  Работают: {nextExercise.muscles.join(', ')}
                </div>
              )}
              {nextExercise.hint && (
                <div className="ws-rest-next__hint">{nextExercise.hint}</div>
              )}
            </div>
          ) : (
            <div className="ws-rest-next">
              <div className="ws-rest-next__name">Дальше: финиш 🎉</div>
            </div>
          )}
          {nextExercise && (
            <video
              src={`/demos/${nextExercise.key}.mp4`}
              preload="auto"
              muted
              playsInline
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            />
          )}
        </div>
      )}

      {ctx.state === 'finishSession' && (
        <div className="ws-finish-wrap">
          <div className="ws-center-card">
            <div className="ws-title">Готово 🎉</div>
            {result ? (
              <>
                <div className="ws-result-row"><span>XP</span><span className="ws-result-val">XP {result.avg_score}</span></div>
                <div className="ws-result-row"><span>Звёзды</span><span className="ws-result-val">⭐ {result.stars_earned}</span></div>
              </>
            ) : (
              <div className="ws-loading ws-loading--inline">Сохраняем результат…</div>
            )}
            <button className="ws-btn ws-btn--primary" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      )}

      {/* Pre-start swipe warning — iOS Telegram pager-swipe can't be fully blocked
          from JS, so we warn the user once before the workout begins. */}
      {showSwipeWarning && (
        <div className="ws-warn-overlay">
          <div className="ws-warn-card">
            <div className="ws-warn-icon">⚠️</div>
            <div className="ws-warn-title">Внимание</div>
            <div className="ws-warn-text">
              Во время тренировки <b>не свайпайте от краёв экрана</b> — это закроет
              приложение и прервёт тренировку. К сожалению, Telegram не позволяет
              полностью отключить этот жест на iOS.
              <br /><br />
              Используйте кнопку «Завершить» в верхнем углу, если нужно остановиться.
            </div>
            <div className="ws-warn-buttons">
              <button className="ws-btn ws-btn--secondary" onClick={() => setShowSwipeWarning(false)}>
                Отмена
              </button>
              <button className="ws-btn ws-btn--primary" onClick={handleConfirmStart}>
                Понял, начинаем
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom confirm modal — fallback when WebApp.showConfirm is unavailable */}
      {showCloseConfirm && (
        <div className="ws-modal-backdrop" onClick={() => setShowCloseConfirm(false)}>
          <div className="ws-modal" onClick={e => e.stopPropagation()}>
            <div className="ws-modal-title">Завершить тренировку?</div>
            <div className="ws-modal-text">Прогресс будет потерян.</div>
            <div className="ws-modal-actions">
              <button className="ws-btn ws-btn--secondary" onClick={() => setShowCloseConfirm(false)}>
                Отмена
              </button>
              <button
                className="ws-btn ws-btn--danger"
                onClick={() => { setShowCloseConfirm(false); handleClose(); }}
              >
                Завершить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkoutScreen;

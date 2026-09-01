import api from './client';

export interface ExerciseMeta {
  idx: number;
  key: string;
  name: string;
  hint: string;
  targets: string;
  position: string;
  muscles: string[];
}

export type SessionType = 'main' | 'light';

export interface WorkoutConfig {
  session_type: SessionType;
  total_exercises: number;
  prepare_sec: number;
  exercise_sec: number;   // длина клипа (record) — одинакова для обоих типов
  work_sec: number;       // полный интервал работы (light > exercise_sec)
  rest_sec: number;
  review_sec: number;
  max_drops_per_session: number;
  exercises: ExerciseMeta[];
}

export interface StartSessionResponse {
  session_id: string;
  started_at: string;
  /** S67: тип и «свободность» решает сервер — фронт подстраивается под ответ. */
  session_type: SessionType;
  is_free: boolean;
}

export interface ClipResponse {
  exercise_idx: number;
  score: number;
  feedback: string;
}

export interface FinishSessionResponse {
  session_id: string;
  total_score: number;
  avg_score: number;
  drops_earned: number;
  // 8c: частичный зачёт + антифарм
  exercises_done: number;
  total_exercises: number;
  completed_full: boolean;
  day_closed: boolean;
  repeat: boolean;
  support_phrase: string | null;
  /** S67: avg_score — это ТЕХНИКА (средний балл Gemini), xp_earned — начисление. */
  xp_earned: number;
  level: number;
  xp_in_level: number;
  level_cost: number;
  level_ups: number[];
  freezes_granted: number;
  is_free: boolean;
}

export async function getWorkoutConfig(sessionType: SessionType = 'main'): Promise<WorkoutConfig> {
  const { data } = await api.get<WorkoutConfig>('/workout/config', {
    params: { session_type: sessionType },
  });
  return data;
}

export async function startWorkoutSession(sessionType: SessionType = 'main'): Promise<StartSessionResponse> {
  const tz_offset_min = -new Date().getTimezoneOffset();
  const { data } = await api.post<StartSessionResponse>('/workout/start', {
    tz_offset_min,
    session_type: sessionType,
  });
  return data;
}

export async function uploadWorkoutClip(
  sessionId: string,
  exerciseIdx: number,
  blob: Blob,
): Promise<ClipResponse> {
  const fd = new FormData();
  fd.append('session_id', sessionId);
  fd.append('exercise_idx', String(exerciseIdx));
  fd.append('video', blob, `${exerciseIdx}.webm`);
  const { data } = await api.post<ClipResponse>('/workout/clip', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // clip analysis can take up to ~60s on fallback model
    timeout: 90_000,
  });
  return data;
}

export async function finishWorkoutSession(sessionId: string): Promise<FinishSessionResponse> {
  const fd = new FormData();
  fd.append('session_id', sessionId);
  const { data } = await api.post<FinishSessionResponse>('/workout/finish', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function cancelWorkoutSession(sessionId: string): Promise<void> {
  const fd = new FormData();
  fd.append('session_id', sessionId);
  await api.post('/workout/cancel', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

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

export interface WorkoutConfig {
  total_exercises: number;
  prepare_sec: number;
  exercise_sec: number;
  rest_sec: number;
  review_sec: number;
  max_stars_per_session: number;
  exercises: ExerciseMeta[];
}

export interface StartSessionResponse {
  session_id: string;
  started_at: string;
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
  stars_earned: number;
}

export async function getWorkoutConfig(): Promise<WorkoutConfig> {
  const { data } = await api.get<WorkoutConfig>('/workout/config');
  return data;
}

export async function startWorkoutSession(): Promise<StartSessionResponse> {
  const tz_offset_min = -new Date().getTimezoneOffset();
  const { data } = await api.post<StartSessionResponse>('/workout/start', { tz_offset_min });
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

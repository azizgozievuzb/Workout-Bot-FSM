/**
 * Frontend mirror of /fsm_blueprints/200_workoutSessionMachine.ts.
 * Implemented as a pure useReducer FSM (no xstate dep).
 * Contract is 1:1 with the blueprint; any change must update both files.
 */
import { useCallback, useReducer } from 'react';

export type WorkoutState =
  | 'idle'
  | 'preparePhase'
  | 'exercisingPhase'
  | 'restAndAnalyzingPhase'
  | 'aiVerdictReview'
  | 'finishSession';

export interface WorkoutContext {
  currentExercise: number;          // 0..15
  globalTimeElapsedMs: number;
  aiScores: number[];               // length 16, 0..100
  aiFeedbacks: (string | null)[];   // length 16
  errorMessage: string | null;
  lastVerdict: { score: number; feedback: string } | null;
}

export type WorkoutEvent =
  | { type: 'START_WORKOUT' }
  | { type: 'TIMER_END' }
  | { type: 'AI_VERDICT'; score: number; feedback: string }
  | { type: 'AI_ERROR' }
  | { type: 'NEXT_EXERCISE' }
  | { type: 'TICK'; deltaMs: number }
  | { type: 'RESET' };

const TOTAL = 16;

const initial = (): WorkoutContext & { state: WorkoutState } => ({
  state: 'idle',
  currentExercise: 0,
  globalTimeElapsedMs: 0,
  aiScores: Array(TOTAL).fill(0),
  aiFeedbacks: Array(TOTAL).fill(null),
  errorMessage: null,
  lastVerdict: null,
});

type FullState = ReturnType<typeof initial>;

function reducer(ctx: FullState, event: WorkoutEvent): FullState {
  switch (event.type) {
    case 'RESET':
      return initial();

    case 'TICK':
      return { ...ctx, globalTimeElapsedMs: ctx.globalTimeElapsedMs + event.deltaMs };

    case 'START_WORKOUT':
      if (ctx.state !== 'idle') return ctx;
      return { ...ctx, state: 'preparePhase' };

    case 'TIMER_END': {
      switch (ctx.state) {
        case 'preparePhase':
          return { ...ctx, state: 'exercisingPhase', errorMessage: null };
        case 'exercisingPhase':
          return { ...ctx, state: 'restAndAnalyzingPhase' };
        case 'restAndAnalyzingPhase':
          return { ...ctx, state: 'aiVerdictReview' };
        default:
          return ctx;
      }
    }

    case 'AI_VERDICT': {
      const scores = [...ctx.aiScores];
      const feedbacks = [...ctx.aiFeedbacks];
      scores[ctx.currentExercise] = event.score;
      feedbacks[ctx.currentExercise] = event.feedback;
      return {
        ...ctx,
        aiScores: scores,
        aiFeedbacks: feedbacks,
        lastVerdict: { score: event.score, feedback: event.feedback },
        errorMessage: null,
      };
    }

    case 'AI_ERROR':
      return {
        ...ctx,
        errorMessage: 'Ошибка: AI не смог проанализировать видео. Начислен 0.',
      };

    case 'NEXT_EXERCISE': {
      if (ctx.state !== 'aiVerdictReview') return ctx;
      const cycleComplete = ctx.currentExercise + 1 >= TOTAL;
      if (cycleComplete) {
        return { ...ctx, state: 'finishSession' };
      }
      return {
        ...ctx,
        state: 'preparePhase',
        currentExercise: ctx.currentExercise + 1,
        errorMessage: null,
        lastVerdict: null,
      };
    }

    default:
      return ctx;
  }
}

export function useWorkoutMachine() {
  const [state, dispatch] = useReducer(reducer, null, initial);
  const send = useCallback((e: WorkoutEvent) => dispatch(e), []);
  return { ctx: state, send };
}

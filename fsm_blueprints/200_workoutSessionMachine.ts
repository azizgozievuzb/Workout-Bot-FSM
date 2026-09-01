import { setup, assign } from 'xstate';

/**
 * 200_WORKOUT_SESSION_MACHINE
 *
 * Чертёж тренировочной сессии. Зеркало в коде — `frontend/src/fsm/
 * workoutSessionMachine.ts` (чистый useReducer, без зависимости от xstate);
 * контракт 1:1, правка одного файла обязывает править второй.
 *
 * Что здесь важно:
 *  - Отдых обязательный, пропустить нельзя.
 *  - Повторов упражнения нет: AI только начисляет баллы (0-100 %).
 *  - Число упражнений ПАРАМЕТРИЗОВАНО (SET_TOTAL): main = 16, light = 4.
 *    Хост шлёт его в `idle` сразу после ответа GET /workout/config.
 *
 * ⚠️ S67 — ветка БЕЗ КАМЕРЫ (свободная тренировка).
 * День вне плана (light-режим не куплен, сегодня не main-день) запускает
 * СВОБОДНУЮ сессию: таймер + демо + счётчик, без записи клипа, без Gemini и
 * без начислений. Решает сервер (`POST /workout/start` → `is_free`), клиент
 * лишь подстраивается: объявить свободный день плановым он не может.
 *
 * ГРАФ СОСТОЯНИЙ У ОБЕИХ ВЕТОК ОДИН И ТОТ ЖЕ — различаются только эффекты:
 *   graded=true  → preparePhase поднимает камеру, exercisingPhase пишет клип,
 *                  restAndAnalyzingPhase грузит его в Gemini (invoke ниже).
 *   graded=false → камера не поднимается, клип не пишется, invoke не идёт;
 *                  restAndAnalyzingPhase — просто отдых, aiVerdictReview —
 *                  та же короткая пауза перед следующим упражнением.
 * Поэтому новых состояний ветка не добавляет: `graded` — контекст + guard.
 *
 * Реальные эффекты (камера, MediaRecorder, upload) живут в хост-компоненте
 * WorkoutScreen, а не внутри машины — здесь они описаны как invoke, чтобы
 * чертёж читался целиком.
 */

export const workoutSessionMachine = setup({
  types: {
    context: {} as {
      currentExercise: number;          // 0 … total-1
      total: number;                    // 16 (main) | 4 (light/свободная)
      graded: boolean;                  // false → свободная: без камеры и AI
      globalTimeElapsedMs: number;      // общее время (TICK, 250 мс)
      aiScores: number[];               // длина `total`, 0-100
      aiFeedbacks: (string | null)[];   // длина `total`
      errorMessage: string | null;
      lastVerdict: { score: number; feedback: string } | null;
    },
    events: {} as
      | { type: 'START_WORKOUT' }
      | { type: 'SET_TOTAL'; total: number }      // 8b: main(16) / light(4)
      | { type: 'SET_GRADED'; graded: boolean }   // S67: свободная тренировка
      | { type: 'TIMER_END' }                     // конец фазы (подход/отдых)
      | { type: 'AI_VERDICT'; score: number; feedback: string }
      | { type: 'AI_ERROR' }
      | { type: 'NEXT_EXERCISE' }
      | { type: 'TICK'; deltaMs: number }
      | { type: 'RESET' }
  },
  actions: {
    setTotal: assign(({ context, event }) => {
      // Разрешено только в idle (до старта) — иначе рвётся активный цикл.
      if (event.type !== 'SET_TOTAL' || event.total < 1) return context;
      return {
        total: event.total,
        aiScores: Array(event.total).fill(0),
        aiFeedbacks: Array(event.total).fill(null),
      };
    }),
    setGraded: assign({
      graded: ({ context, event }) =>
        event.type === 'SET_GRADED' ? event.graded : context.graded,
    }),
    tick: assign({
      globalTimeElapsedMs: ({ context, event }) =>
        event.type === 'TICK' ? context.globalTimeElapsedMs + event.deltaMs : context.globalTimeElapsedMs,
    }),
    incrementExercise: assign({
      currentExercise: ({ context }) => context.currentExercise + 1,
      errorMessage: null,
      lastVerdict: null,
    }),
    saveAiScore: assign(({ context, event }) => {
      if (event.type !== 'AI_VERDICT') return context;
      const scores = [...context.aiScores];
      const feedbacks = [...context.aiFeedbacks];
      scores[context.currentExercise] = event.score;      // % успешности подхода
      feedbacks[context.currentExercise] = event.feedback;
      return {
        aiScores: scores,
        aiFeedbacks: feedbacks,
        lastVerdict: { score: event.score, feedback: event.feedback },
        errorMessage: null,
      };
    }),
    recordError: assign({
      errorMessage: "Ошибка: AI не смог проанализировать видео. Начислен 0."
    }),
    // RESET возвращает и состояние, и контекст к начальным (в зеркале — initial()).
    resetContext: assign({
      currentExercise: 0,
      total: 16,
      graded: true,
      globalTimeElapsedMs: 0,
      aiScores: Array(16).fill(0),
      aiFeedbacks: Array(16).fill(null),
      errorMessage: null,
      lastVerdict: null
    })
  },
  guards: {
    // Последнее упражнение пройдено (total параметризован — не 15 в лоб).
    isCycleComplete: ({ context }) => context.currentExercise + 1 >= context.total,
    // S67: оценка идёт только в плановой сессии.
    isGraded: ({ context }) => context.graded
  }
}).createMachine({
  id: 'workoutSessionMachine',
  initial: 'idle',
  context: {
    currentExercise: 0,
    total: 16,
    graded: true,
    globalTimeElapsedMs: 0,
    aiScores: Array(16).fill(0),
    aiFeedbacks: Array(16).fill(null),
    errorMessage: null,
    lastVerdict: null
  },
  on: {
    TICK: { actions: 'tick' },
    RESET: { target: '.idle', actions: 'resetContext' }
  },
  states: {
    // Экран «Готовы?»: число упражнений и режим приезжают до старта.
    idle: {
      on: {
        SET_TOTAL: { actions: 'setTotal' },
        SET_GRADED: { actions: 'setGraded' },
        START_WORKOUT: 'preparePhase'
      }
    },
    // Подготовка (main 5 c, light 10 c). graded → поднимаем камеру.
    preparePhase: {
      meta: { "@statelyai.color": "blue" },
      on: { TIMER_END: 'exercisingPhase' }
    },
    // Работа (main 60 c, light 180 c). graded → пишем клип (ровно 60 c).
    exercisingPhase: {
      meta: { "@statelyai.color": "purple" },
      on: { TIMER_END: 'restAndAnalyzingPhase' }
    },
    // Отдых (main 30 c, light 60 c). В плановой сессии параллельно грузим
    // клип в Gemini; в свободной invoke не запускается вовсе — guard 'isGraded'.
    restAndAnalyzingPhase: {
      meta: { "@statelyai.color": "orange" },
      invoke: {
        // @ts-ignore
        src: 'uploadAndAnalyzeVideo',
        // @ts-ignore
        guard: 'isGraded',
        onDone: { actions: 'saveAiScore' },
        onError: { actions: 'recordError' }
      },
      // Переход — строго по таймеру отдыха, ответ AI его не торопит.
      on: {
        TIMER_END: 'aiVerdictReview',
        AI_VERDICT: { actions: 'saveAiScore' },
        AI_ERROR: { actions: 'recordError' }
      }
    },
    // Короткая пауза после подхода (review_sec). Хост уходит дальше сам,
    // без тапа; баллы за подход в середине цикла НЕ показываются.
    aiVerdictReview: {
      meta: { "@statelyai.color": "green" },
      on: {
        NEXT_EXERCISE: [
          { target: 'finishSession', guard: 'isCycleComplete' },
          { target: 'preparePhase', actions: 'incrementExercise' }
        ]
      }
    },
    // Сессия завершена → POST /workout/finish.
    // graded=true  → капли, XP, уровень, стрик (антифарм: 1 main + 1 light в день).
    // graded=false → ноль начислений; сессия сохраняется как is_free.
    finishSession: {
      meta: { "@statelyai.color": "green" },
      type: 'final'
    }
  }
});

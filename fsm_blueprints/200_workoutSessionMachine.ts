import { setup, assign } from 'xstate';

/**
 * 200_WORKOUT_SESSION_MACHINE
 * 
 * Идеальная архитектура Тренировочной Сессии (Цикл из 16 упражнений).
 * - Управляет умными таймерами (Date.now() resilient).
 * - Параллельно обрабатывает ИИ-отправку во время отдыха.
 * - Ведет счетчик упражнений.
 */

export const workoutSessionMachine = setup({
  types: {
    context: {} as {
      currentExercise: number; // От 0 до 15
      globalTimeElapsed: number; // Общее время в секундах
      aiVerdicts: ('PASS' | 'RETRY' | null)[];
      attemptsCount: number; // Кол-во попыток на текущее упражнение
      errorMessage: string | null;
    },
    events: {} as
      | { type: 'START_WORKOUT' }
      | { type: 'TIMER_END' } // Триггер от фронтенда (таймер закончился)
      | { type: 'SKIP_REST' }
      | { type: 'AI_VERDICT_PASS' }
      | { type: 'AI_VERDICT_RETRY'; errorDetails: string }
      | { type: 'RETRY_EXERCISE' }
      | { type: 'NEXT_EXERCISE' }
  },
  actions: {
    incrementExercise: assign({
      currentExercise: ({ context }) => context.currentExercise + 1,
      attemptsCount: 0, // Сбрасываем попытки для нового упражнения
      errorMessage: null
    }),
    incrementAttempt: assign({
      attemptsCount: ({ context }) => context.attemptsCount + 1
    }),
    savePassVerdict: assign({
      aiVerdicts: ({ context }) => {
        const newVerdicts = [...context.aiVerdicts];
        newVerdicts[context.currentExercise] = 'PASS';
        return newVerdicts;
      }
    }),
    saveRetryVerdict: assign({
      aiVerdicts: ({ context, event }) => {
        const newVerdicts = [...context.aiVerdicts];
        newVerdicts[context.currentExercise] = 'RETRY';
        return newVerdicts;
      },
      errorMessage: ({ event }) => event.type === 'AI_VERDICT_RETRY' ? event.errorDetails : 'Technical error'
    })
  },
  guards: {
    isCycleComplete: ({ context }) => context.currentExercise >= 15,
    hasMoreAttempts: ({ context }) => context.attemptsCount < 2
  }
}).createMachine({
  id: 'workoutSessionMachine',
  initial: 'idle',
  context: {
    currentExercise: 0,
    globalTimeElapsed: 0,
    aiVerdicts: Array(16).fill(null),
    attemptsCount: 0,
    errorMessage: null
  },
  states: {
    // Начало тренировки
    idle: {
      on: { START_WORKOUT: 'preparePhase' }
    },
    // Подготовка (Например, ставим телефон, таймер 5 сек)
    preparePhase: {
      meta: { "@statelyai.color": "blue" },
      on: { TIMER_END: 'exercisingPhase' } 
    },
    // Само Упражнение (40 секунд таймер, запись камеры)
    exercisingPhase: {
      meta: { "@statelyai.color": "purple" },
      on: { TIMER_END: 'restAndAnalyzingPhase' }
    },
    // Отдых + Отправка видео в Gemini
    restAndAnalyzingPhase: {
      meta: { "@statelyai.color": "orange" },
      // Имитация того, что фронтенд посылает видео и ждет
      invoke: {
        src: 'uploadAndAnalyzeVideo',
        onDone: { target: 'verdictPass', actions: 'savePassVerdict' },
        onError: { target: 'verdictRetry', actions: ['saveRetryVerdict', 'incrementAttempt'] }
      },
      // Кнопка пропуска отдыха (но мы все равно дождемся ИИ)
      on: { SKIP_REST: 'waitingForAI' } 
    },
    // Если пропустили отдых, а ИИ еще не ответил
    waitingForAI: {
      meta: { "@statelyai.color": "yellow" },
      invoke: {
        src: 'uploadAndAnalyzeVideo',
        onDone: { target: 'verdictPass', actions: 'savePassVerdict' },
        onError: { target: 'verdictRetry', actions: ['saveRetryVerdict', 'incrementAttempt'] }
      }
    },
    // Оцениваем вердикт
    verdictPass: {
      meta: { "@statelyai.color": "green" },
      on: {
        NEXT_EXERCISE: [
          { target: 'finishSession', guard: 'isCycleComplete' },
          { target: 'preparePhase', actions: 'incrementExercise' }
        ]
      }
    },
    verdictRetry: {
      meta: { "@statelyai.color": "red" },
      // Проверяем, остались ли попытки
      always: [
        { target: 'verdictFailedSkip', guard: ({ context }) => !context.hasMoreAttempts }
      ],
      // Иначе даем кнопку "Сделать еще раз"
      on: {
        RETRY_EXERCISE: { target: 'preparePhase' }
      }
    },
    // Провалил 2 попытки - идем дальше
    verdictFailedSkip: {
      meta: { "@statelyai.color": "orange" },
      on: {
        NEXT_EXERCISE: [
          { target: 'finishSession', guard: 'isCycleComplete' },
          { target: 'preparePhase', actions: 'incrementExercise' }
        ]
      }
    },
    finishSession: {
      meta: { "@statelyai.color": "green" },
      type: 'final'
    }
  }
});

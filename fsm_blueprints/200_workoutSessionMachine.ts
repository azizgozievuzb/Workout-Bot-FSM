import { setup, assign } from 'xstate';

/**
 * 200_WORKOUT_SESSION_MACHINE
 * 
 * Обновленная архитектура Тренировочной Сессии.
 * - Обязательный отдых без пропуска.
 * - Нет принудительных повторений, только начисление/вычет баллов AI.
 * - Поддержка расчета процентов удержания (0-100%).
 */

export const workoutSessionMachine = setup({
  types: {
    context: {} as {
      currentExercise: number; // От 0 до 15
      globalTimeElapsed: number; // Общее время
      aiScores: number[]; // Оценки от AI процентов качества (0-100%)
      errorMessage: string | null;
    },
    events: {} as
      | { type: 'START_WORKOUT' }
      | { type: 'TIMER_END' } // Триггер таймера (подхода или отдыха)
      | { type: 'AI_VERDICT'; score: number } // AI присылает балл
      | { type: 'NEXT_EXERCISE' } // Пользователь соглашается с результатом и идет дальше
  },
  actions: {
    incrementExercise: assign({
      currentExercise: ({ context }) => context.currentExercise + 1,
      errorMessage: null
    }),
    saveAiScore: assign({
      aiScores: ({ context, event }) => {
        if (event.type !== 'AI_VERDICT') return context.aiScores;
        const newScores = [...context.aiScores];
        // Сохраняем процент успешности за подход (0, 50, 90, 100...)
        newScores[context.currentExercise] = event.score;
        return newScores;
      }
    }),
    recordError: assign({
      errorMessage: "Ошибка: AI не смог проанализировать видео. Начислен 0."
    })
  },
  guards: {
    isCycleComplete: ({ context }) => context.currentExercise >= 15
  }
}).createMachine({
  id: 'workoutSessionMachine',
  initial: 'idle',
  context: {
    currentExercise: 0,
    globalTimeElapsed: 0,
    aiScores: Array(16).fill(0),
    errorMessage: null
  },
  states: {
    // Старт
    idle: {
      on: { START_WORKOUT: 'preparePhase' }
    },
    // Подготовка (Например, ставим телефон, таймер 5 сек)
    preparePhase: {
      meta: { "@statelyai.color": "blue" },
      on: { TIMER_END: 'exercisingPhase' } 
    },
    // Само Упражнение (40 секунд таймер)
    exercisingPhase: {
      meta: { "@statelyai.color": "purple" },
      on: { TIMER_END: 'restAndAnalyzingPhase' }
    },
    // Отдых (Обязательный) + Анализ AI
    restAndAnalyzingPhase: {
      meta: { "@statelyai.color": "orange" },
      // Пока идет отдых, мы параллельно ждем ответ от AI
      invoke: {
        // @ts-ignore
        src: 'uploadAndAnalyzeVideo',
        // Если AI ответил быстро – просто сохраняем балл в контекст
        onDone: { actions: 'saveAiScore' },
        onError: { actions: 'recordError' }
      },
      // Переход на следующий этап только по таймеру отдыха
      on: { 
        TIMER_END: 'aiVerdictReview'
      } 
    },
    // Показ результата за прошедший подход (баллы)
    aiVerdictReview: {
      meta: { "@statelyai.color": "green" },
      on: {
        NEXT_EXERCISE: [
          { target: 'finishSession', guard: 'isCycleComplete' },
          { target: 'preparePhase', actions: 'incrementExercise' }
        ]
      }
    },
    // Тренировка завершена
    finishSession: {
      meta: { "@statelyai.color": "green" },
      type: 'final'
    }
  }
});

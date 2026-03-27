import { createMachine, assign } from 'xstate';

/**
 * WorkoutFlow Machine (PRO Mini App - Offline Stable):
 * Архитектура без лагов. Загрузка в начале, Вердикт в конце.
 */
export const workoutFlowMachine = createMachine({
  id: 'WorkoutFlow',
  initial: 'idle',
  context: {
    difficulty: null as 'LIGHT' | 'STRONG' | 'GOD_MODE' | null,
    exercisesInRound: [] as any[],
    currentRound: 1,
    totalRounds: 2,
    currentIndex: 0,
    hasDoneToday: false,
    starsAccumulated: 0
  },
  states: {
    idle: {
      on: { START: 'checkDailyLimit' }
    },

    checkDailyLimit: {
      always: [
        { target: 'alreadyDone', guard: ({ context }: any) => context.hasDoneToday },
        { target: 'selectDifficulty' }
      ]
    },

    alreadyDone: {
      on: { GET_FACTS: 'alreadyDone', BACK: 'idle' }
    },

    selectDifficulty: {
      on: {
        CHOOSE_LIGHT: { target: 'preloading', actions: assign({ difficulty: 'LIGHT' }) },
        CHOOSE_STRONG: { target: 'preloading', actions: assign({ difficulty: 'STRONG' }) },
        CHOOSE_GOD: { target: 'preloading', actions: assign({ difficulty: 'GOD_MODE' }) }
      }
    },

    // 1. ЗАГРУЗКА (Предварительная): Скачиваем всё видео в кэш телефона
    preloading: {
      invoke: {
        src: 'preloadMediaAndScenarios',
        onDone: 'preparationStep',
        onError: 'selectDifficulty'
      }
    },

    // -----------------------------------------------------
    // ЛОКАЛЬНЫЙ ЦИКЛ ПЕРЕКЛЮЧЕНИЙ (Работает без интернета!)
    // -----------------------------------------------------

    preparationStep: {
      after: {
        10000: 'activeWorkout'
      },
      on: { READY: 'activeWorkout' }
    },

    activeWorkout: {
      entry: 'startLocalRecording',
      after: {
        // Таймер берется из загруженного сценария (например 60000ms или 240000ms)
        EXERCISE_DURATION: 'restPhase'
      },
      on: { ABORT: 'selectDifficulty' }
    },

    restPhase: {
      entry: 'stopLocalRecording',
      after: {
        30000: 'checkNext'
      },
      on: { SKIP: 'checkNext' }
    },

    checkNext: {
      always: [
        // Еще есть упражнения? -> назад к подготовке
        { target: 'preparationStep', guard: 'hasMoreExercises' },
        // Все сделано? -> Кнопка "ЗАКОНЧИТЬ ТРЕНИРОВКУ"
        { target: 'awaitingFinalClick' }
      ]
    },

    // -----------------------------------------------------
    // ФИНАЛЬНАЯ СТАДИЯ (Когда она нажала "Законить")
    // -----------------------------------------------------

    awaitingFinalClick: {
      on: { FINISH_WORKOUT: 'verdictProcessing' }
    },

    verdictProcessing: {
      description: 'Экран: "Подожди вердикта, выкладываем видео и зовем ИИ..."',
      invoke: {
        src: 'uploadAndAnalyzeProcess', // Загрузка всех видео + Gemini API
        onDone: {
          target: 'success',
          actions: assign({ starsAccumulated: ({ event }: any) => event.output.stars })
        },
        onError: 'success' // Даже если ошибка - даем базу
      }
    },

    success: {
      entry: 'updateGlobalDatabase',
      on: { CLOSE: 'idle' }
    }
  }
});

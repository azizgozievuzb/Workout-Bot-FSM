import { createMachine, assign } from 'xstate';

/**
 * WorkoutFlow Machine:
 * Многоуровневый цикл тренировки (Сессия из нескольких упражнений)
 */
export const workoutFlowMachine = createMachine({
  id: 'WorkoutFlow',
  initial: 'idle',
  context: {
    difficulty: null as 'EASY' | 'MEDIUM' | 'HARD' | null,
    exercisesLeft: 3, // Количество упражнений в сессии (например, 3)
    currentExerciseIndex: 0,
    aiScore: 0,
    totalStars: 0,
    hasDoneToday: false
  },
  states: {
    idle: {
      on: {
        USER_CLICKS_START: 'checkDailyLimit'
      }
    },

    checkDailyLimit: {
      always: [
        { target: 'alreadyDone', guard: ({ context }: any) => context.hasDoneToday },
        { target: 'selectDifficulty' }
      ]
    },

    alreadyDone: {
      on: {
        GET_INTERESTING_FACT: { target: 'alreadyDone' },
        BACK_TO_MENU: 'idle'
      }
    },

    selectDifficulty: {
      on: {
        CHOOSE_EASY: { target: 'startSession', actions: assign({ difficulty: 'EASY', exercisesLeft: 3 }) },
        CHOOSE_MEDIUM: { target: 'startSession', actions: assign({ difficulty: 'MEDIUM', exercisesLeft: 4 }) },
        CHOOSE_HARD: { target: 'startSession', actions: assign({ difficulty: 'HARD', exercisesLeft: 5 }) }
      }
    },

    // 4. Начало сессии: Инициализация списка упражнений
    startSession: {
      always: 'showExercise'
    },

    // 5. Показ упражнения + ВИДИМЫЙ таймер (отправка видео-отсчета 15с)
    showExercise: {
      entry: 'sendVisibleCountdownVideo', // Действие: отправить кружок 15..14..13
      after: {
        17000: 'performingSession' // Авто-переход через 17с (с запасом на прогрузку)
      },
      on: {
        I_READY: 'performingSession'
      }
    },

    // 6. АКТИВНАЯ ФАЗА: Она выполняет упражнение вместе с видео (90 сек)
    performingSession: {
      description: 'Экран WebApp: сверху инструктор, снизу камера девушки',
      after: {
        90000: 'submissionTimeout' // Если через 90с видео не получено
      },
      on: {
        RECEIVE_VIDEO: {
          target: 'aiEvaluation',
          actions: 'saveVideoId'
        }
      }
    },

    submissionTimeout: {
      entry: 'sendSlowMsg',
      on: { RETRY: 'showExercise', CANCEL: 'idle' }
    },

    // 7. Проверка ИИ (Проверка текущего упражнения)
    aiEvaluation: {
      invoke: {
        src: 'analyzeVideoWithGemini',
        onDone: {
          target: 'rewardCalculations',
          actions: assign({ aiScore: ({ event }: any) => event.output.score })
        },
        onError: 'rewardCalculations'
      }
    },

    // 8. Расчет за упражнение и ПРОВЕРКА ЦИКЛА
    rewardCalculations: {
      entry: ['calculateStarsForStep', 'incrementExerciseIndex'],
      always: [
        { target: 'restPhase', guard: ({ context }: any) => context.currentExerciseIndex < context.exercisesLeft },
        { target: 'showFinalSuccess' }
      ]
    },

    // 9. ОТДЫХ: Короткая пауза между упражнениями (например, 30 сек)
    restPhase: {
      after: {
        30000: 'showExercise'
      },
      on: {
        SKIP_REST: 'showExercise'
      }
    },

    // 10. ФИНАЛ: Общие итоги за все упражнения сразу
    showFinalSuccess: {
      entry: 'updateUserStreakAndLeague',
      on: { CLOSE: 'idle' }
    }
  }
});




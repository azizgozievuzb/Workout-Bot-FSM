import { createMachine, assign } from 'xstate';

/**
 * WorkoutFlow Machine:
 * Основной игровой цикл тренировки (Блюпринт)
 */
export const workoutFlowMachine = createMachine({
  id: 'WorkoutFlow',
  initial: 'idle',
  context: {
    difficulty: null as 'EASY' | 'MEDIUM' | 'HARD' | null,
    currentExerciseId: null as number | null,
    hasDoneToday: false, // Флаг из БД
    aiScore: 0, // Оценка ИИ (0-100%)
    starsEarned: 0
  },
  states: {
    idle: {
      on: {
        USER_CLICKS_START: 'checkDailyLimit'
      }
    },

    // 1. Проверка лимита: Можно ли тренироваться сегодня?
    checkDailyLimit: {
      always: [
        { target: 'alreadyDone', guard: ({ context }: any) => context.hasDoneToday },
        { target: 'selectDifficulty' }
      ]
    },

    // 2. Лимит исчерпан: Показываем факт и блокируем вход
    alreadyDone: {
      on: {
        GET_INTERESTING_FACT: {
          target: 'alreadyDone',
          actions: 'showRandomHealthFact'
        },
        BACK_TO_MENU: 'idle'
      }
    },

    // 3. Выбор сложности: Кнопки 🟢🟡🔴
    selectDifficulty: {
      on: {
        CHOOSE_EASY: {
          target: 'showExercise',
          actions: assign({ difficulty: 'EASY' })
        },
        CHOOSE_MEDIUM: {
          target: 'showExercise',
          actions: assign({ difficulty: 'MEDIUM' })
        },
        CHOOSE_HARD: {
          target: 'showExercise',
          actions: assign({ difficulty: 'HARD' })
        }
      }
    },

    // 4. Демонстрация задания (Текст + GIF)
    showExercise: {
      on: {
        I_READY: 'waitForProof'
      }
    },

    // 5. ОЖИДАНИЕ ПРУФА: Бот ждет видео (до 1 мин)
    waitForProof: {
      on: {
        RECEIVE_VIDEO: {
          target: 'aiEvaluation',
          actions: 'saveVideoId'
        }
      }
    },

    // 6. ПРОВЕРКА ИИ: Gemini анализирует старания
    aiEvaluation: {
      invoke: {
        src: 'analyzeVideoWithGemini',
        onDone: {
          target: 'rewardCalculations',
          actions: assign({ aiScore: ({ event }: any) => event.output.score })
        },
        onError: 'rewardCalculations' // Если ИИ упал, все равно даем базу
      }
    },

    // 7. РАСЧЕТ НАГРАД: Начисление Звезд + Бонусов
    rewardCalculations: {
      entry: [
        'calculateBaseStars',
        { type: 'applyAiBonus', guard: ({ context }: any) => context.aiScore >= 50 }
      ],
      always: 'showFinalSuccess'
    },

    // 8. ФИНАЛ: Салют, комплименты, обновление Огонька 🔥
    showFinalSuccess: {
      entry: 'updateUserStreak',
      on: {
        CLOSE: 'idle'
      }
    }
  }
});


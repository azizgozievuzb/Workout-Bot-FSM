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
    hasDoneToday: false,
    aiScore: 0,
    starsEarned: 0
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
        GET_INTERESTING_FACT: {
          target: 'alreadyDone',
          actions: 'showRandomHealthFact'
        },
        BACK_TO_MENU: 'idle'
      }
    },

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

    // 4. Показ упражнения + Таймер на раздумья (15 сек)
    showExercise: {
      after: {
        15000: 'nudgeUser' // Если через 15 сек не нажала "Готова"
      },
      on: {
        I_READY: 'waitForProof'
      }
    },

    // 4a. Подгонялка (если засмотрелась на видео)
    nudgeUser: {
      entry: 'sendHurryUpMessage',
      on: {
        I_READY: 'waitForProof'
      }
    },

    // 5. ОЖИДАНИЕ ПРУФА: Таймер на запись (60-120 сек)
    waitForProof: {
      entry: 'startSubmissionTimer',
      after: {
        120000: 'submissionTimeout' // 2 минуты на съемку и загрузку
      },
      on: {
        RECEIVE_VIDEO: {
          target: 'aiEvaluation',
          actions: 'saveVideoId'
        }
      }
    },

    // 5a. Время вышло (не успела отправить)
    submissionTimeout: {
      entry: 'sendSlowpokeMessage',
      on: {
        RETRY: 'showExercise',
        CANCEL: 'idle'
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
        onError: 'rewardCalculations'
      }
    },

    // 7. РАСЧЕТ НАГРАД
    rewardCalculations: {
      entry: [
        'calculateBaseStars',
        { type: 'applyAiBonus', guard: ({ context }: any) => context.aiScore >= 50 }
      ],
      always: 'showFinalSuccess'
    },

    // 8. ФИНАЛ
    showFinalSuccess: {
      entry: 'updateUserStreak',
      on: {
        CLOSE: 'idle'
      }
    }
  }
});



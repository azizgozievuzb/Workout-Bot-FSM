import { createMachine, assign } from 'xstate';

/**
 * WorkoutFlow Machine (PRO Mini App - Strict Submodule):
 * Режим "Жесткая Дисциплина". Никаких пауз. Только работа.
 * Включает: Лимит 1/день, Выбор сложности, 35-мин цикл, Вердикт ИИ.
 */
export const workoutFlowMachine = createMachine({
  id: 'WorkoutFlow',
  initial: 'checkDailyLimit',
  context: {
    difficulty: null as 'LIGHT' | 'STRONG' | 'GOD_MODE' | null,
    exercisesList: [] as any[],
    currentIndex: 0,
    hasDoneToday: false,
    starsAccumulated: 0,
    aiScore: 0
  },
  states: {
    // 1. ЛИМИТ: 1 тренировка в сутки
    checkDailyLimit: {
      always: [
        { target: 'alreadyDone', guard: ({ context }: any) => context.hasDoneToday },
        { target: 'selectDifficulty' }
      ]
    },

    // 2. БЛОКИРОВКА + Интересные факты от ИИ
    alreadyDone: {
      on: {
        GET_FACTS: { target: 'alreadyDone', actions: 'showRandomHealthFact' },
        BACK: { target: '#WorkoutFlow', actions: 'exitToParent' }
      }
    },

    // 3. ВЫБОР СЛОЖНОСТИ (Влияет на состав 35-мин сессии)
    selectDifficulty: {
      on: {
        CHOOSE_LIGHT: { target: 'preloading', actions: assign({ difficulty: 'LIGHT' }) },
        CHOOSE_STRONG: { target: 'preloading', actions: assign({ difficulty: 'STRONG' }) },
        CHOOSE_GOD: { target: 'preloading', actions: assign({ difficulty: 'GOD_MODE' }) },
        BACK: { target: '#WorkoutFlow', actions: 'exitToParent' }
      }
    },

    // 4. ПРЕДЗАГРУЗКА: Видео в кэш + разрешения камеры + WakeLock
    preloading: {
      entry: ['requestCameraPermissions', 'enableWakeLock'],
      invoke: {
        src: 'preloadMediaAndScenarios',
        onDone: {
          target: 'activeTraining',
          actions: assign({ exercisesList: ({ event }: any) => event.output.list })
        },
        onError: 'selectDifficulty'
      }
    },

    // 5. АКТИВНЫЙ ТРЕНИРОВОЧНЫЙ ЦИКЛ (35 МИНУТ, оффлайн)
    activeTraining: {
      initial: 'preparation',
      on: {
        APP_MINIMIZED: 'cancelled',
        FORCE_STOP: 'cancelled'
      },
      states: {
        preparation: {
          entry: 'showExercisePreview',
          after: { 10000: 'active' },
          on: { READY: 'active' }
        },
        active: {
          entry: 'startAutorecording',
          after: { EXERCISE_DURATION: 'rest' }
        },
        rest: {
          entry: 'stopAutorecording',
          after: { 30000: 'checkNext' },
          on: { SKIP: 'checkNext' }
        },
        checkNext: {
          always: [
            { target: 'preparation', guard: 'hasMore' },
            { target: '#WorkoutFlow.finished' }
          ]
        }
      }
    },

    // 6. ФИНАЛ: Кнопка "Закончить тренировку"
    finished: {
      exit: 'disableWakeLock',
      on: { FINISH_WORKOUT: 'verdict' }
    },

    // 7. ВЕРДИКТ: Загрузка видео + ИИ-анализ
    verdict: {
      invoke: {
        src: 'uploadAndAnalyzeWithGemini',
        onDone: {
          target: 'success',
          actions: assign({
            starsAccumulated: ({ event }: any) => event.output.stars,
            aiScore: ({ event }: any) => event.output.score
          })
        },
        onError: {
          target: 'success',
          actions: assign({ starsAccumulated: 10 }) // Базовая награда при ошибке ИИ
        }
      }
    },

    // 8. УСПЕХ: Комплимент от ИИ + начисление звезд
    success: {
      entry: ['updateStreakInDB', 'sendAICompliment'],
      on: { CLOSE: { target: '#WorkoutFlow', actions: 'exitToParent' } }
    },

    // 9. ОТМЕНА: Проваленная тренировка
    cancelled: {
      entry: ['disableWakeLock', 'showDisappointmentMessage'],
      on: { BACK: { target: '#WorkoutFlow', actions: 'exitToParent' } }
    }
  }
});

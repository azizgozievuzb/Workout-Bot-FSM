import { createMachine, assign } from 'xstate';

/**
 * WorkoutFlow Machine (PRO Mini App - Strict Submodule):
 * Режим "Жесткая Дисциплина". Никаких пауз. Только работа.
 */
export const workoutFlowMachine = createMachine({
  id: 'WorkoutFlow',
  initial: 'idle',
  context: {
    difficulty: null as 'LIGHT' | 'STRONG' | 'GOD_MODE' | null,
    exercisesList: [] as any[], // 2 Кардио + 6 Переменных слотов
    currentIndex: 0,
    hasDoneToday: false,
    starsAccumulated: 0
  },
  states: {
    idle: {
      on: { START: 'loading' }
    },

    // 1. ЗАГРУЗКА И ПОДГОТОВКА (Оффлайн-кэш)
    loading: {
      invoke: {
        src: 'fetchAdminScenarios',
        onDone: {
          target: 'activeTraining',
          actions: assign({ exercisesList: ({ event }: any) => event.output.list })
        },
        onError: 'idle'
      }
    },

    // 2. АКТИВНЫЙ ТРЕНИРОВОЧНЫЙ ЦИКЛ (35 МИНУТ)
    activeTraining: {
      initial: 'preparation',
      on: {
        // ЛЮБОЕ сворачивание приложения = ОТМЕНА (без сохранения)
        APP_MINIMIZED: 'cancelled',
        FORCE_STOP: 'cancelled'
      },
      states: {
        // Подготовка: 10 сек (Превью)
        preparation: {
          after: { 10000: 'active' },
          on: { READY: 'active' }
        },
        // Работа: (1 мин или 4 мин) - Камера пишет всегда
        active: {
          entry: 'startAutorecording',
          after: { EXERCISE_DURATION: 'rest' } 
        },
        // Отдых: 30 сек
        rest: {
          entry: 'stopAutorecording',
          after: { 30000: 'checkNext' },
          on: { SKIP: 'checkNext' }
        },
        // Цикл
        checkNext: {
          always: [
            { target: 'preparation', guard: 'hasMore' },
            { target: '#WorkoutFlow.finished' }
          ]
        }
      }
    },

    // 3. ФИНАЛ: Остановка и Вердикт
    finished: {
      on: { FINISH_WORKOUT: 'verdict' }
    },

    verdict: {
      invoke: {
        src: 'uploadToGeminiAI',
        onDone: {
          target: 'success',
          actions: assign({ starsAccumulated: 100 }) // Пример
        },
        onError: 'success'
      }
    },

    success: {
      on: { CLOSE: 'idle' }
    },

    // 4. ТУПИК: Проваленная тренировка (за звонок или выход)
    cancelled: {
      entry: 'showDisappointmentMessage',
      on: { BACK: 'idle' }
    }
  }
});



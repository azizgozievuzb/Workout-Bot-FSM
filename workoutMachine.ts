import { createMachine, assign } from 'xstate';

/**
 * WorkoutFlow Machine (PRO Mini App Edition):
 * Блюпринт для 35-минутной тренировки с кругами и авто-камерой.
 */
export const workoutFlowMachine = createMachine({
  id: 'WorkoutFlow',
  initial: 'idle',
  context: {
    difficulty: null as 'LIGHT' | 'STRONG' | 'GOD_MODE' | null,
    roundsCount: 2, // Количество кругов (например, 2 круга)
    currentRound: 1,
    exercisesInRound: [] as any[], // Список упражнений для текущей сложности
    currentExerciseIndex: 0,
    isMirrorModeOn: true, // Фронталка всегда включена в UI
    totalStars: 0,
    hasDoneToday: false
  },
  states: {
    idle: {
      on: { USER_CLICKS_START: 'checkDailyLimit' }
    },

    checkDailyLimit: {
      always: [
        { target: 'alreadyDone', guard: ({ context }: any) => context.hasDoneToday },
        { target: 'selectDifficulty' }
      ]
    },

    alreadyDone: {
      on: { 
        GET_FACTS: { target: 'alreadyDone' },
        BACK: 'idle' 
      }
    },

    // 1. Выбор уровня (Влияет на интенсивность и количество упражнений в 35 мин)
    selectDifficulty: {
      on: {
        CHOOSE_LIGHT: { target: 'loadSession', actions: assign({ difficulty: 'LIGHT' }) },
        CHOOSE_STRONG: { target: 'loadSession', actions: assign({ difficulty: 'STRONG' }) },
        CHOOSE_GOD: { target: 'loadSession', actions: assign({ difficulty: 'GOD_MODE' }) }
      }
    },

    // 2. Загрузка данных сессии из БД (список 4х минутных и 1 минутных заданий)
    loadSession: {
      always: 'preparationStep'
    },

    // 3. ПОДГОТОВКА (10 сек): Показ превью следующего видео
    preparationStep: {
      entry: 'showExercisePreview',
      after: {
        10000: 'activeExercise' // Авто-старт через 10 секунд
      },
      on: { SKIP_PREP: 'activeExercise' }
    },

    // 4. АКТИВНАЯ ФАЗА (Тренировка вместе с тренером)
    // В Mini App: Видео сверху, камера снизу.
    activeExercise: {
      entry: 'startAutorecording', // Автоматически начинаем писать "пруф"
      after: {
        // Длительность берется из настроек конкретного упражнения (60 сек или 240 сек)
        EXERCISE_DURATION: 'handleExerciseEnd'
      },
      on: {
        // Если она каким-то образом прервала видео раньше
        STOP_MANUALLY: 'restPhase'
      }
    },

    handleExerciseEnd: {
      entry: 'stopAutorecording',
      always: 'restPhase'
    },

    // 5. ОТДЫХ (30 сек): "Спящий режим" приложения
    restPhase: {
      entry: 'showRestScreen',
      after: {
        30000: 'checkNextStep'
      },
      on: { SKIP_REST: 'checkNextStep' }
    },

    // 6. ПРОВЕРКА ЦИКЛА: Круги и следующее упражнение
    checkNextStep: {
      always: [
        // Еще есть задания в текущем круге
        { 
          target: 'preparationStep', 
          guard: ({ context }: any) => context.currentExerciseIndex < context.exercisesInRound.length 
        },
        // Круг закончен, но есть следующий круг
        { 
          target: 'preparationStep', 
          guard: ({ context }: any) => context.currentRound < context.roundsCount,
          actions: 'startNextRound' 
        },
        // Вся тренировка (35 мин) окончена
        { target: 'uploadResults' }
      ]
    },

    // 7. ЗАГРУЗКА ОТЧЕТОВ И АНАЛИЗ
    uploadResults: {
      invoke: {
        src: 'uploadVideoSnippets',
        onDone: 'aiFinalEvaluation',
        onError: 'showFinalSuccess'
      }
    },

    aiFinalEvaluation: {
      invoke: {
        src: 'analyzeFullSessionWithGemini',
        onDone: 'showFinalSuccess'
      }
    },

    // 8. ИТОГИ: Начисление наград и комплименты
    showFinalSuccess: {
      entry: 'updateUserStreakAndLeague',
      on: { CLOSE: 'idle' }
    }
  }
});





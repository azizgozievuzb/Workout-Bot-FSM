import { createMachine, assign } from 'xstate';

/**
 * WorkoutFlow Machine (PRO Mini App - Resilience Edition):
 * Архитектура со "щитом" от звонков и не затухающим экраном.
 */
export const workoutFlowMachine = createMachine({
  id: 'WorkoutFlow',
  initial: 'idle',
  context: {
    difficulty: null as 'LIGHT' | 'STRONG' | 'GOD_MODE' | null,
    exercisesInRound: [] as any[],
    currentIndex: 0,
    hasDoneToday: false,
    starsAccumulated: 0,
    pausedFromState: '' // Запоминаем, откуда ушли на паузу
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

    // 1. ПОДГОТОВКА И ПРАВА: Запрос Камеры + Включение WakeLock (Экран не гаснет)
    preloading: {
      entry: ['requestCameraPermissions', 'enableWakeLock'], 
      invoke: {
        src: 'preloadMediaAndScenarios',
        onDone: 'preparationStep',
        onError: 'selectDifficulty'
      }
    },

    // --- ЛОКАЛЬНЫЙ ЦИКЛ С ГЛОБАЛЬНОЙ ПАУЗОЙ ---

    preparationStep: {
      after: { 10000: 'activeWorkout' },
      on: { 
        READY: 'activeWorkout',
        APP_MINIMIZED: { target: 'globalPaused', actions: assign({ pausedFromState: 'preparationStep' }) }
      }
    },

    activeWorkout: {
      entry: 'startLocalRecording',
      after: { EXERCISE_DURATION: 'restPhase' },
      on: { 
        ABORT: 'selectDifficulty',
        APP_MINIMIZED: { target: 'globalPaused', actions: assign({ pausedFromState: 'activeWorkout' }) }
      }
    },

    restPhase: {
      entry: 'stopLocalRecording',
      after: { 30000: 'checkNext' },
      on: { 
        SKIP: 'checkNext',
        APP_MINIMIZED: { target: 'globalPaused', actions: assign({ pausedFromState: 'restPhase' }) }
      }
    },

    // 2. ГЛОБАЛЬНАЯ ПАУЗА (Срабатывает при звонке или сворачивании)
    globalPaused: {
      entry: 'pauseAllMedia',
      on: {
        RESUME: [
          { target: 'preparationStep', guard: ({ context }: any) => context.pausedFromState === 'preparationStep' },
          { target: 'activeWorkout', guard: ({ context }: any) => context.pausedFromState === 'activeWorkout' },
          { target: 'restPhase', guard: ({ context }: any) => context.pausedFromState === 'restPhase' }
        ]
      }
    },

    checkNext: {
      always: [
        { target: 'preparationStep', guard: 'hasMoreExercises' },
        { target: 'awaitingFinalClick' }
      ]
    },

    awaitingFinalClick: {
      on: { FINISH_WORKOUT: 'verdictProcessing' }
    },

    // 3. ФИНАЛ: Выключаем WakeLock (Экран теперь может гаснуть)
    verdictProcessing: {
      exit: 'disableWakeLock',
      invoke: {
        src: 'uploadAndAnalyzeProcess',
        onDone: {
          target: 'success',
          actions: assign({ starsAccumulated: ({ event }: any) => event.output.stars })
        },
        onError: 'success'
      }
    },

    success: {
      entry: 'updateGlobalDatabase',
      on: { CLOSE: 'idle' }
    }
  }
});


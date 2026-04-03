import { setup, assign } from 'xstate';

/**
 * 103_WORKOUT_GATE_MACHINE
 * 
 * Пред-тренировочная комната (раздевалка).
 * Отображает 3-дневный рейтинг, активные бусты и текущее окно уровней.
 * Не имеет кнопок выбора сложности (она рассчитывается автоматически сервером).
 */

export const workoutGateMachine = setup({
  types: {
    context: {} as {
      globalScore: number;
      threeDayScore: number;
      targetThreeDayScore: number; // Цель для повышения уровня
      currentLevelWindow: [number, number, number]; // Окно из 3 уровней
      activeBoost: '1_day' | '1_week' | null;
      checkoutResult: any | null; 
    },
    events: {} as
      | { type: 'CONTINUE' }
      | { type: 'I_AM_READY' }
      | { type: 'BACK_TO_MENU' }
      | { type: 'WORKOUT_SUCCESS'; data: any } 
  },
  actions: {
    saveWorkoutResult: assign({
      checkoutResult: ({ event }) => event.type === 'WORKOUT_SUCCESS' ? event.data : null
    })
  }
}).createMachine({
  id: 'workoutGateMachine',
  initial: 'fetchingData',
  context: {
    globalScore: 0,
    threeDayScore: 0,
    targetThreeDayScore: 1000,
    currentLevelWindow: [1, 2, 3], // Окно из 3 уровней по-умолчанию
    activeBoost: null,
    checkoutResult: null
  },
  states: {
    // 1. Стучимся на бэкенд, чтобы получить актуальный рейтинг и бусты
    fetchingData: {
      meta: { "@statelyai.color": "blue" },
      invoke: {
        src: 'fetchUserWorkoutStats',
        onDone: {
          target: 'greetings',
          actions: assign({
            globalScore: ({ event }) => event.output.globalScore,
            threeDayScore: ({ event }) => event.output.threeDayScore,
            targetThreeDayScore: ({ event }) => event.output.targetThreeDayScore,
            currentLevelWindow: ({ event }) => event.output.currentLevelWindow,
            activeBoost: ({ event }) => event.output.activeBoost
          })
        },
        onError: 'errorFetchingData'
      }
    },
    errorFetchingData: {
      meta: { "@statelyai.color": "red" },
      on: { CONTINUE: 'fetchingData', BACK_TO_MENU: 'exitGate' }
    },
    
    // 2. Экран с рейтингом (Global / 3-Day), стрик-окном и плашкой буста
    greetings: {
      meta: { "@statelyai.color": "green" },
      on: { CONTINUE: 'equipmentCheck', BACK_TO_MENU: 'exitGate' }
    },
    
    // 3. Напоминание подготовить стул или другой инвентарь
    equipmentCheck: {
      meta: { "@statelyai.color": "yellow" },
      on: { I_AM_READY: 'workoutExecution', BACK_TO_MENU: 'exitGate' }
    },
    
    // 4. Ловушка: запускает машину 200_workoutSessionMachine
    workoutExecution: {
      meta: { "@statelyai.color": "purple" },
      invoke: {
        src: 'workoutSessionMachine',
        onDone: { target: 'workoutSummary', actions: 'saveWorkoutResult' },
        // Если игрок принудительно отменил тренировку через Telegram-меню
        onError: { target: 'exitGate' } 
      }
    },
    
    // 5. Показ результатов текущей сессии (сколько монет заработал)
    workoutSummary: {
      meta: { "@statelyai.color": "green" },
      on: { BACK_TO_MENU: 'exitGate' }
    },
    
    // 6. Возврат в Главное Меню
    exitGate: {
      meta: { "@statelyai.color": "gray" },
      type: 'final'
    }
  }
});

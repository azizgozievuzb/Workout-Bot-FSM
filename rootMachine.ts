import { createMachine } from 'xstate';

/**
 * RootAppMachine: Главный управляющий модуль приложения.
 * Переключает глобальные режимы: Меню, Тренировка, Магазин, Админка.
 */
export const rootMachine = createMachine({
  id: 'RootApp',
  initial: 'authenticating',
  states: {
    // 1. Проверка: это Игрок или Админ?
    authenticating: {
      on: {
        IS_USER: 'mainMenu',
        IS_ADMIN: 'adminPanel'
      }
    },

    // 2. Главное меню игрока
    mainMenu: {
      on: {
        START_WORKOUT: 'workoutMode',
        GO_SHOP: 'shopMode'
      }
    },

    // 3. ПОДМОДУЛЬ: РЕЖИМ ТРЕНИРОВКИ (35 мин)
    workoutMode: {
      // Здесь мы вызываем (invoke) нашу WorkoutFlowMachine
      on: {
        WORKOUT_FINISHED: 'mainMenu',
        WORKOUT_CANCELLED: 'mainMenu'
      }
    },

    // 4. ПОДМОДУЛЬ: МАГАЗИН
    shopMode: {
      on: { BACK: 'mainMenu' }
    },

    // 5. ПОДМОДУЛЬ: АДМИН-ПАНЕЛЬ
    adminPanel: {
      on: { 
        LOGOUT: 'authenticating',
        RELOAD_EXERCISES: { target: 'adminPanel', actions: 'refreshDB' }
      }
    }
  }
});

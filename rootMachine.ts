import { createMachine } from 'xstate';

/**
 * RootAppMachine: Главный управляющий модуль.
 * 3 роли: PLAYER (Игрок), RESPONSIBLE (Ответственный), ADMIN (Суперадмин).
 */
export const rootMachine = createMachine({
  id: 'RootApp',
  initial: 'checkingAuth',
  states: {
    // 1. Проверка: зарегистрирован ли пользователь?
    checkingAuth: {
      always: [
        { target: 'adminPanel', guard: 'isAdmin' },
        { target: 'onboarding', guard: 'isNewUser' },
        { target: 'playerMenu', guard: 'isPlayer' },
        { target: 'responsibleMenu', guard: 'isResponsible' }
      ]
    },

    // 2. Первый вход: Сбор роли, имени, связка пары
    onboarding: {
      invoke: {
        src: 'onboardingMachine',
        onDone: 'checkingAuth' // После онбординга — повторная проверка роли
      }
    },

    // 3. Главное меню ИГРОКА (Девушка)
    playerMenu: {
      on: {
        START_WORKOUT: 'workoutMode',
        GO_SHOP: 'shopMode',
        VIEW_STATS: 'playerMenu'
      }
    },

    // 4. ПОДМОДУЛЬ: ТРЕНИРОВКА (35 мин)
    workoutMode: {
      invoke: {
        src: 'workoutFlowMachine',
        onDone: 'playerMenu'
      },
      on: {
        WORKOUT_FINISHED: 'playerMenu',
        WORKOUT_CANCELLED: 'playerMenu'
      }
    },

    // 5. ПОДМОДУЛЬ: МАГАЗИН
    shopMode: {
      invoke: {
        src: 'shopMachine',
        onDone: 'playerMenu'
      },
      on: { BACK: 'playerMenu' }
    },

    // 6. Меню ОТВЕТСТВЕННОГО (Парень)
    responsibleMenu: {
      invoke: {
        src: 'responsibleMachine',
        onDone: 'responsibleMenu'
      },
      on: { LOGOUT: 'checkingAuth' }
    },

    // 7. СУПЕРАДМИН (Только вы)
    adminPanel: {
      invoke: {
        src: 'adminMachine',
        onDone: 'adminPanel'
      },
      on: { LOGOUT: 'checkingAuth' }
    }
  }
});

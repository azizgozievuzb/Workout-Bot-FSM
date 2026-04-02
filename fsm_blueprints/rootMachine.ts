import { setup, assign } from 'xstate';

/**
 * ROOT MACHINE v3.1 (Visual Clean Version)
 * 
 * Упрощенная линейная структура для идеального отображения в Stately.
 * Никаких перехлестов: Язык -> Роль -> Гендер -> Роутинг.
 */

export const rootMachine = setup({
  types: {
    context: {} as {
      lang: 'ru' | 'uz' | 'en' | null;
      userRole: 'player' | 'responsible' | 'admin' | null;
      targetGender: 'male' | 'female' | null;
      userId: string | null;
      hasActiveSub: boolean;
    },
    events: {} as
      | { type: 'SET_LANG'; lang: 'ru' | 'uz' | 'en' }
      | { type: 'SET_ROLE'; role: 'player' | 'responsible' | 'admin' }
      | { type: 'SET_GENDER'; gender: 'male' | 'female' }
      | { type: 'START_APP'; userId: string }
      | { type: 'PAYMENT_OK' }
      | { type: 'RETRY' }
  },
  actions: {
    assignLang: assign({ lang: ({ event }) => event.type === 'SET_LANG' ? event.lang : null }),
    assignRole: assign({ userRole: ({ event }) => event.type === 'SET_ROLE' ? event.role : null }),
    assignGender: assign({ targetGender: ({ event }) => event.type === 'SET_GENDER' ? event.gender : null }),
    saveUserID: assign({ userId: ({ event }) => event.type === 'START_APP' ? event.userId : null }),
  },
  guards: {
    isNewUser: ({ event }) => event.type === 'done.invoke.fetchProfile' && event.output === null,
    userExists: ({ event }) => event.type === 'done.invoke.fetchProfile' && event.output !== null,
    needsPayment: ({ context }) => context.userRole === 'responsible' && !context.hasActiveSub,
    needsToWait: ({ context }) => context.userRole === 'player' && !context.hasActiveSub,
    isAdmin: ({ context }) => context.userRole === 'admin',
    isReady: ({ context }) => context.hasActiveSub
  }
}).createMachine({
  id: 'rootMachine',
  initial: 'idle',
  context: {
    lang: null,
    userRole: null,
    targetGender: null,
    userId: null,
    hasActiveSub: false,
  },
  states: {
    idle: {
      on: {
        START_APP: {
          target: 'checkingProfile',
          actions: 'saveUserID'
        }
      }
    },

    // 💡 ТУТ НАЧИНАЕТСЯ ОЧИЩЕННАЯ ВЕРТИКАЛЬНАЯ ЛОГИКА
    checkingProfile: {
      invoke: {
        src: 'fetchProfile',
        onDone: [
          { target: 'routing', guard: 'userExists' },
          { target: 'languageSelection', guard: 'isNewUser' }
        ],
        onError: 'error'
      }
    },

    languageSelection: {
      on: { SET_LANG: { target: 'roleSelection', actions: 'assignLang' } }
    },

    roleSelection: {
      on: { SET_ROLE: { target: 'genderSelection', actions: 'assignRole' } }
    },

    genderSelection: {
      on: { SET_GENDER: { target: 'routing', actions: 'assignGender' } }
    },

    routing: {
      always: [
        { guard: 'isAdmin', target: 'adminFlow' },
        { guard: 'needsPayment', target: 'paymentFlow' },
        { guard: 'needsToWait', target: 'blockedScreen' },
        { target: 'mainAppFlow' } // Состояние, когда всё хорошо
      ]
    },

    paymentFlow: {
      on: { PAYMENT_OK: { target: 'mainAppFlow', actions: assign({ hasActiveSub: true }) } }
    },

    blockedScreen: {
      on: { PAYMENT_OK: 'mainAppFlow' }
    },

    adminFlow: { type: 'final' },
    mainAppFlow: { type: 'final' },

    error: {
      on: { RETRY: 'checkingProfile' }
    }
  }
});

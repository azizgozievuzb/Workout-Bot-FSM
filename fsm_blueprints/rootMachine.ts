import { setup, assign } from 'xstate';

/**
 * ROOT MACHINE v3 (Global Logic: Language + Pair + Gender)
 * 
 * ПОЛНЫЙ ЦИКЛ ПЕРВОГО ЗАПУСКА:
 * 1. Выбор языка (RU/EN/UZ)
 * 2. Выбор роли (Self/Gift)
 * 3. Выбор пола контента (🚺 Her / 🚹 Him)
 * 4. Проверка и оплата
 */

export const rootMachine = setup({
  types: {
    context: {} as {
      lang: 'ru' | 'uz' | 'en' | null;
      userRole: 'player' | 'responsible' | 'admin' | null;
      targetGender: 'male' | 'female' | null; // Тот, КТО будет тренироваться
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
    setError: assign({ userRole: null }) // Сброс при критической ошибке
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
    // 1. Старт и первичная проверка
    idle: {
      on: {
        START_APP: {
          target: 'checkingProfileInDB',
          actions: 'saveUserID'
        }
      }
    },

    // 2. Ищем юзера в БД (У него уже настроен язык и роль?)
    checkingProfileInDB: {
      invoke: {
        src: 'fetchProfile',
        onDone: [
          { target: 'routing', guard: ({ event }) => event.output !== null },
          { target: 'languageSelection' } // Если новый юзер -> Начинаем Онбординг
        ],
        onError: 'error'
      }
    },

    // --- БЛОК ОНБОРДИНГА (Новый юзер) ---
    languageSelection: {
      on: { SET_LANG: { target: 'roleSelection', actions: 'assignLang' } }
    },

    roleSelection: {
      on: {
        SET_ROLE: [
          { target: 'genderSelection', actions: 'assignRole', guard: ({ event }) => event.role === 'responsible' },
          { target: 'genderSelection', actions: 'assignRole', guard: ({ event }) => event.role === 'player' }
        ]
      }
    },

    genderSelection: {
      on: { SET_GENDER: { target: 'routing', actions: 'assignGender' } }
    },

    // 3. Главный Светофор (Routing)
    routing: {
      always: [
        { guard: ({ context }) => context.userRole === 'admin', target: 'adminFlow' },
        { 
          guard: ({ context }) => context.userRole === 'responsible' && !context.hasActiveSub, 
          target: 'paymentFlow' 
        },
        { 
          guard: ({ context }) => context.userRole === 'player' && !context.hasActiveSub, 
          target: 'blockedScreen' 
        },
        { target: 'mainAppFlow' } // Финал: Всё оплачено, роль ясна
      ]
    },

    // --- БЛОКИ ТУПИКОВ / ОЖИДАНИЯ ---
    paymentFlow: {
      on: { PAYMENT_OK: { target: 'mainAppFlow', actions: assign({ hasActiveSub: true }) } }
    },

    blockedScreen: {
      // Игрок ждет, пока Ответственный оплатит (Бот пришлет сигнал от партнерского аккаунта)
      on: { PAYMENT_OK: 'mainAppFlow' }
    },

    adminFlow: { type: 'final' },
    mainAppFlow: { type: 'final' }, // Кнопки тренировки, магазин и т.д.

    error: {
      on: { RETRY: 'checkingProfileInDB' }
    }
  }
});

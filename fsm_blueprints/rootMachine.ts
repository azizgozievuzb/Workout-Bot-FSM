import { setup, assign } from 'xstate';

/**
 * УЛУЧШЕННЫЙ РОУТЕР ПРИЛОЖЕНИЯ (Root Machine v2)
 * 
 * ДОБАВЛЕНО:
 * 1. Проверка подписки (Subscription Flow).
 * 2. Изолированный блок Платежей (Payment Flow).
 * 
 * ПРИНЦИПЫ:
 * - Разделение ответственности: Платежи — это отдельный домен.
 * - Устойчивость: При ошибке оплаты возвращаемся в безопасное состояние.
 */

export const rootMachine = setup({
  types: {
    context: {} as {
      userRole: 'guest' | 'player' | 'responsible' | 'admin' | null;
      userId: string | null;
      hasActiveSubscription: boolean;
    },
    events: {} as
      | { type: 'START_APP'; userId: string }
      | { type: 'RETRY' }
      | { type: 'PAYMENT_SUCCESS' } // Событие от внешней платежной машины
  },
  guards: {
    isGuest: ({ context }) => context.userRole === 'guest',
    isPlayer: ({ context }) => context.userRole === 'player',
    isResponsible: ({ context }) => context.userRole === 'responsible',
    isAdmin: ({ context }) => context.userRole === 'admin',
    noSubscription: ({ context }) => !context.hasActiveSubscription,
    hasSubscription: ({ context }) => context.hasActiveSubscription,
  },
  actions: {
    saveUserId: assign({
      userId: ({ event }) => (event.type === 'START_APP' ? event.userId : null)
    }),
    saveRoleAndSubscription: assign({
      userRole: ({ event }) => (event.type === 'done.invoke.fetchUserInfo' ? event.output.role : null),
      hasActiveSubscription: ({ event }) => (event.type === 'done.invoke.fetchUserInfo' ? event.output.hasSub : false)
    }),
    setSubscribed: assign({ hasActiveSubscription: true }),
    logSystemError: () => console.error('Ошибка доступа к данным пользователя'),
  },
}).createMachine({
  id: 'rootMachine',
  initial: 'idle',
  context: {
    userRole: null,
    userId: null,
    hasActiveSubscription: false,
  },
  states: {
    idle: {
      on: {
        START_APP: {
          target: 'checkingUserInfo',
          actions: 'saveUserId'
        }
      }
    },
    // Проверка Роли + Статуса Подписки за один запрос
    checkingUserInfo: {
      invoke: {
        src: 'fetchUserInfo', // Запрос в БД (Роль + Подписка)
        onDone: {
          target: 'routing',
          actions: 'saveRoleAndSubscription'
        },
        onError: {
          target: 'error',
          actions: 'logSystemError'
        }
      }
    },
    routing: {
      always: [
        { guard: 'isGuest', target: 'onboardingFlow' },
        { guard: 'isAdmin', target: 'adminFlow' },
        { guard: 'isResponsible', target: 'responsibleFlow' },
        // Если это Игрок -> Переходим к проверке подписки
        { guard: 'isPlayer', target: 'playerSubscriptionCheck' },
        { target: 'error' }
      ]
    },
    // Проверка подписки для Игрока
    playerSubscriptionCheck: {
      always: [
        { guard: 'hasSubscription', target: 'playerMenuFlow' },
        { guard: 'noSubscription', target: 'paymentFlow' }
      ]
    },
    // ИЗОЛИРОВАННЫЙ БЛОК ПЛАТЕЖЕЙ (Здесь будет активация кодов)
    paymentFlow: {
      on: {
        PAYMENT_SUCCESS: {
          target: 'playerMenuFlow',
          actions: 'setSubscribed'
        }
      }
    },
    playerMenuFlow: { type: 'final' },
    onboardingFlow: { type: 'final' },
    responsibleFlow: { type: 'final' },
    adminFlow: { type: 'final' },
    error: {
      on: {
        RETRY: 'checkingUserInfo'
      }
    }
  }
});

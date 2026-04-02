import { setup, assign } from 'xstate';

/**
 * ГЛАВНЫЙ РОУТЕР ПРИЛОЖЕНИЯ (Root Machine)
 * 
 * ПРИНЦИПЫ:
 * 1. Single Responsibility (S в SOLID): Только маршрутизация.
 * 2. Interface Segregation: Внешние сервисы (БД) инжектируются через 'src'.
 * 3. Type Safety: Полная типизация ролей и ID пользователя.
 */

export const rootMachine = setup({
  types: {
    context: {} as {
      userRole: 'guest' | 'player' | 'responsible' | 'admin' | null;
      userId: string | null;
    },
    events: {} as
      | { type: 'START_APP'; userId: string }
      | { type: 'RETRY' }
  },
  // ГУАРДЫ (Условия) - Даем им имена, чтобы убрать восклицательные знаки в Stately
  guards: {
    isGuest: ({ context }) => context.userRole === 'guest',
    isPlayer: ({ context }) => context.userRole === 'player',
    isResponsible: ({ context }) => context.userRole === 'responsible',
    isAdmin: ({ context }) => context.userRole === 'admin',
  },
  // ЭКШЕНЫ (Действия)
  actions: {
    saveUserId: assign({
      userId: ({ event }) => (event.type === 'START_APP' ? event.userId : null)
    }),
    saveRole: assign({
      userRole: ({ event }) => (event.type === 'done.invoke.fetchUserRoleFromDB' ? event.output : null)
    }),
    logSystemError: () => console.error('Критическая ошибка доступа к БД (Паттерн Предохранитель активирован)'),
  },
}).createMachine({
  id: 'rootMachine',
  initial: 'idle',
  context: {
    userRole: null,
    userId: null,
  },
  states: {
    idle: {
      on: {
        START_APP: {
          target: 'checkingRole',
          actions: 'saveUserId'
        }
      }
    },
    checkingRole: {
      invoke: {
        src: 'fetchUserRoleFromDB',
        onDone: {
          target: 'routing',
          actions: 'saveRole'
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
        { guard: 'isPlayer', target: 'playerFlow' },
        { guard: 'isResponsible', target: 'responsibleFlow' },
        { guard: 'isAdmin', target: 'adminFlow' },
        { target: 'error' } // Если роль не определена
      ]
    },
    onboardingFlow: { type: 'final' },
    playerFlow: { type: 'final' },
    responsibleFlow: { type: 'final' },
    adminFlow: { type: 'final' },
    error: {
      on: {
        RETRY: 'checkingRole'
      }
    }
  }
});

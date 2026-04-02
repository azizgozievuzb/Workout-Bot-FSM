import { setup, assign } from 'xstate';

// ---------------------------------------------------------
// PRINCIPLES APPLIED:
// 1. Идемпотентность - кнопка START_APP сработает 1 раз.
// 2. Resiliency - если БД падает, мы переходим в error_state с возможностью RETRY.
// 3. Delegation (SOLID: SRP) - Root машина только маршрутизирует, она не управляет тренировками.
// ---------------------------------------------------------

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
  actions: {
    // В реальности здесь будет отправляться аналитика
    logSystemError: () => console.log('Сбой доступа к Supabase, ждем ответа от юзера'),
  },
}).createMachine({
  id: 'rootMachine',
  initial: 'idle',
  context: {
    userRole: null,
    userId: null,
  },
  states: {
    // Начальное состояние при открытии бота/App
    idle: {
      on: {
        START_APP: {
          target: 'checkingRole',
          actions: assign({ userId: ({ event }) => event.userId })
        }
      }
    },
    // Асинхронное состояние: запрос в базу данных для проверки роли
    checkingRole: {
      invoke: {
        src: 'fetchUserRoleFromDB', // Это интерфейс, реальная функция передается извне
        onDone: {
          target: 'routing',
          actions: assign({ userRole: ({ event }) => event.output })
        },
        onError: {
          target: 'error',
          actions: 'logSystemError' // Паттерн "Предохранитель"
        }
      }
    },
    // Мгновенное (Транзитное) состояние маршрутизатора
    routing: {
      always: [
        { guard: ({ context }) => context.userRole === 'guest', target: 'onboardingFlow' },
        { guard: ({ context }) => context.userRole === 'player', target: 'playerFlow' },
        { guard: ({ context }) => context.userRole === 'responsible', target: 'responsibleFlow' },
        { guard: ({ context }) => context.userRole === 'admin', target: 'adminFlow' },
        { target: 'error' } // Fallback (если роли нет в списке)
      ]
    },
    // Это "Гнезда" (Sockets) для запуска дочерних машин (Наших блоков со схемы)
    onboardingFlow: {
      type: 'final' // Пока заглушка
    },
    playerFlow: {
      type: 'final'
    },
    responsibleFlow: {
      type: 'final'
    },
    adminFlow: {
      type: 'final'
    },
    // Состояние ошибки (Офлайн-устойчивость)
    error: {
      on: {
        RETRY: 'checkingRole' // Пользователь нажал "Попробовать снова"
      }
    }
  }
});

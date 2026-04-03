import { setup, assign } from 'xstate';

/**
 * 102_ADMIN_MACHINE
 * 
 * Контрольная панель для Администратора.
 * Загрузка видео происходит напрямую через Supabase/Telegram Channel.
 * Данная машина служит для модерации (Баны) и просмотра статистики.
 */

export const adminMachine = setup({
  types: {
    context: {} as {
      adminId: string;
      selectedModule: 'users' | 'content' | 'stats' | null;
      selectedUserForBan: string | null;
      statsData: any | null;
    },
    events: {} as
      | { type: 'SELECT_MODULE'; module: 'users' | 'content' | 'stats' }
      | { type: 'BACK' }
      | { type: 'SEARCH_USER' }
      | { type: 'USER_FOUND'; userId: string }
      | { type: 'CONFIRM_BAN' }
      | { type: 'STATS_LOADED'; data: any }
      | { type: 'EXIT_ADMIN_PANEL' }
  },
  actions: {
    setModule: assign({ selectedModule: ({ event }) => event.type === 'SELECT_MODULE' ? event.module : null }),
    setUserForBan: assign({ selectedUserForBan: ({ event }) => event.type === 'USER_FOUND' ? event.userId : null }),
    clearSelection: assign({ selectedModule: null, selectedUserForBan: null }),
    setStats: assign({ statsData: ({ event }) => event.type === 'STATS_LOADED' ? event.data : null })
  }
}).createMachine({
  id: 'adminMachine',
  initial: 'adminDashboard',
  context: {
    adminId: 'admin_1', // Передается из Root
    selectedModule: null,
    selectedUserForBan: null,
    statsData: null
  },
  states: {
    adminDashboard: {
      meta: { "@statelyai.color": "blue" },
      on: {
        SELECT_MODULE: [
          { target: 'managingUsers', guard: ({ event }) => event.module === 'users', actions: 'setModule' },
          { target: 'managingContent', guard: ({ event }) => event.module === 'content', actions: 'setModule' },
          { target: 'fetchingStats', guard: ({ event }) => event.module === 'stats', actions: 'setModule' }
        ],
        EXIT_ADMIN_PANEL: 'exitAdmin'
      }
    },
    
    // =============================
    // Ветка Статистики
    // =============================
    fetchingStats: {
      meta: { "@statelyai.color": "blue" },
      invoke: {
        // @ts-ignore
        src: 'fetchSystemStats',
        onDone: { target: 'viewingStats', actions: 'setStats' },
        onError: 'adminDashboard'
      }
    },
    viewingStats: {
      meta: { "@statelyai.color": "green" },
      on: { BACK: { target: 'adminDashboard', actions: 'clearSelection' } }
    },
    
    // =============================
    // Ветка Управления Юзерами
    // =============================
    managingUsers: {
      meta: { "@statelyai.color": "orange" },
      on: {
        SEARCH_USER: 'managingUsers', // Здесь админ ввел ID для поиска (остаемся тут же)
        USER_FOUND: { target: 'confirmBan', actions: 'setUserForBan' },
        BACK: { target: 'adminDashboard', actions: 'clearSelection' }
      }
    },
    confirmBan: {
      meta: { "@statelyai.color": "red" },
      invoke: {
        // @ts-ignore
        src: 'banUserInDB', // Бэкенд банит обоих в связке
        onDone: { target: 'adminDashboard', actions: 'clearSelection' }, 
        onError: 'managingUsers' // Не смогли забанить
      },
      on: {
        BACK: 'managingUsers' // Отмена
      }
    },

    // =============================
    // Ветка Контента (Инфо)
    // =============================
    managingContent: {
      meta: { "@statelyai.color": "purple" },
      // Информативный экран. Бот пишет: "Для загрузки видео используйте Supabase Studio + Telegram CDN канал".
      on: { BACK: { target: 'adminDashboard', actions: 'clearSelection' } }
    },

    // Выход из админки в корень бота
    exitAdmin: {
      meta: { "@statelyai.color": "gray" },
      type: 'final'
    }
  }
});

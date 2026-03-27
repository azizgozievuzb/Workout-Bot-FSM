import { createMachine, assign } from 'xstate';

/**
 * AdminControlMachine: Суперадмин (Только вы).
 * Управление парами, видео-библиотекой и глобальной статистикой.
 */
export const adminMachine = createMachine({
  id: 'AdminPanel',
  initial: 'dashboard',
  context: {
    selectedLevel: 1,
    videoSlots: {
      cardio: [null, null],
      variable: [null, null, null, null, null, null]
    },
    couples: [] as any[],
    globalStats: null as any
  },
  states: {
    // 1. ГЛАВНЫЙ ЭКРАН АДМИНА
    dashboard: {
      on: {
        MANAGE_EXERCISES: 'selectLevel',
        MANAGE_COUPLES: 'coupleManagement',
        VIEW_STATS: 'globalStatistics',
        LOGOUT: { target: '#AdminPanel', actions: 'exitToParent' }
      }
    },

    // --- УПРАВЛЕНИЕ УПРАЖНЕНИЯМИ ---

    // 2. Выбор уровня сложности
    selectLevel: {
      on: {
        SELECT: { target: 'editLevelMode', actions: assign({ selectedLevel: ({ event }: any) => event.level }) },
        BACK: 'dashboard'
      }
    },

    // 3. Редактирование слотов
    editLevelMode: {
      on: {
        UPLOAD_TO_SLOT: 'uploadingVideo',
        SAVE_CHANGES: 'savingToDB',
        BACK: 'selectLevel'
      }
    },

    uploadingVideo: {
      invoke: {
        src: 'uploadToStorage',
        onDone: { target: 'editLevelMode', actions: 'updateContextSlot' },
        onError: 'editLevelMode'
      }
    },

    savingToDB: {
      invoke: {
        src: 'saveToSupabase',
        onDone: 'dashboard',
        onError: 'editLevelMode'
      }
    },

    // --- УПРАВЛЕНИЕ ПАРАМИ ---

    // 4. Список пар (Whitelist)
    coupleManagement: {
      invoke: {
        src: 'fetchAllCouples',
        onDone: {
          target: 'coupleList',
          actions: assign({ couples: ({ event }: any) => event.output })
        },
        onError: 'dashboard'
      }
    },

    coupleList: {
      on: {
        ADD_COUPLE: 'addingCouple',
        REMOVE_COUPLE: { target: 'coupleList', actions: 'removeCoupleFromList' },
        BACK: 'dashboard'
      }
    },

    addingCouple: {
      on: {
        CONFIRM: { target: 'coupleList', actions: 'appendCoupleToList' },
        CANCEL: 'coupleList'
      }
    },

    // --- ГЛОБАЛЬНАЯ СТАТИСТИКА ---

    // 5. Обзор всех пользователей
    globalStatistics: {
      invoke: {
        src: 'fetchGlobalStats',
        onDone: {
          target: 'showingStats',
          actions: assign({ globalStats: ({ event }: any) => event.output })
        },
        onError: 'dashboard'
      }
    },

    showingStats: {
      on: { BACK: 'dashboard' }
    }
  }
});

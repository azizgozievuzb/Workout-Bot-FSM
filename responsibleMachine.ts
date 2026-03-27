import { createMachine, assign } from 'xstate';

/**
 * ResponsibleMachine: Интерфейс "Ответственного" (Парень).
 * Пополняет магазин, видит прогресс партнера (с задержкой 24ч),
 * настраивает уведомления.
 */
export const responsibleMachine = createMachine({
  id: 'ResponsiblePanel',
  initial: 'mainScreen',
  context: {
    partnerNickname: '',
    partnerStats: null as any, // Звезды, стрик, последняя тренировка
    shopItems: [] as any[],
    notificationSettings: {
      telegramEnabled: true,
      emailEnabled: false,
      email: ''
    }
  },
  states: {
    // 1. ГЛАВНЫЙ ЭКРАН ОТВЕТСТВЕННОГО
    mainScreen: {
      on: {
        VIEW_PROGRESS: 'partnerProgress',
        MANAGE_SHOP: 'manageShopItems',
        EDIT_NOTIFICATIONS: 'notificationSettings',
        LOGOUT: { target: '#ResponsiblePanel', actions: 'exitToParent' }
      }
    },

    // 2. ПРОГРЕСС ПАРТНЕРА (с задержкой 24ч)
    partnerProgress: {
      invoke: {
        src: 'fetchPartnerStatsDelayed24h',
        onDone: {
          target: 'showingProgress',
          actions: assign({ partnerStats: ({ event }: any) => event.output })
        },
        onError: 'mainScreen'
      }
    },

    showingProgress: {
      on: { BACK: 'mainScreen' }
    },

    // 3. УПРАВЛЕНИЕ МАГАЗИНОМ (Добавить / Удалить подарки)
    manageShopItems: {
      invoke: {
        src: 'fetchCurrentShopItems',
        onDone: {
          target: 'editingShop',
          actions: assign({ shopItems: ({ event }: any) => event.output })
        },
        onError: 'mainScreen'
      }
    },

    editingShop: {
      on: {
        ADD_ITEM: 'addingNewItem',
        REMOVE_ITEM: { target: 'editingShop', actions: 'removeItemFromList' },
        SAVE_SHOP: 'savingShop',
        BACK: 'mainScreen'
      }
    },

    addingNewItem: {
      on: {
        CONFIRM_ITEM: {
          target: 'editingShop',
          actions: 'appendItemToList'
        },
        CANCEL: 'editingShop'
      }
    },

    savingShop: {
      invoke: {
        src: 'saveShopItemsToDB',
        onDone: 'mainScreen',
        onError: 'editingShop'
      }
    },

    // 4. НАСТРОЙКИ УВЕДОМЛЕНИЙ (Telegram + Email)
    notificationSettings: {
      on: {
        TOGGLE_TELEGRAM: { target: 'notificationSettings', actions: 'toggleTelegram' },
        TOGGLE_EMAIL: { target: 'notificationSettings', actions: 'toggleEmail' },
        SET_EMAIL: {
          target: 'notificationSettings',
          actions: assign({ notificationSettings: ({ context, event }: any) => ({
            ...context.notificationSettings,
            email: event.value
          })})
        },
        SAVE_SETTINGS: 'savingNotifications',
        BACK: 'mainScreen'
      }
    },

    savingNotifications: {
      invoke: {
        src: 'saveNotificationSettingsToDB',
        onDone: 'mainScreen',
        onError: 'notificationSettings'
      }
    }
  }
});

import { createMachine, assign } from 'xstate';

/**
 * ShopMachine: Система наград и обмена звезд.
 * Совмещает покупку за звезды (валюта) и разблокировку за стрики (достижения).
 */
export const shopMachine = createMachine({
  id: 'ShopPanel',
  initial: 'loadingShop',
  context: {
    userStars: 0,   // Текущее золото
    userStreak: 0,  // Огоньки (непрерывные дни)
    items: [] as any[], // Динамический список из БД (Админки)
    selectedItem: null as any
  },
  states: {
    // 1. ЗАГРУЗКА: Получаем баланс и стрик из базы (Supabase)
    loadingShop: {
      invoke: {
        src: 'fetchShopData',
        onDone: {
          target: 'idle',
          actions: assign({ 
            userStars: ({ event }: any) => event.output.stars,
            userStreak: ({ event }: any) => event.output.streak,
            items: ({ event }: any) => event.output.items
          })
        },
        onError: 'idle'
      }
    },

    // 2. ГЛАВНЫЙ ЭКРАН МАГАЗИНА: Листаем подарки
    idle: {
      on: {
        SELECT_ITEM: { target: 'itemDetails', actions: assign({ selectedItem: ({ event }: any) => event.item }) },
        BACK_TO_MENU: 'finished'
      }
    },

    // 3. КАРТОЧКА ТОВАРА: Проверка условий
    itemDetails: {
      on: {
        // Попытка купить за Звезды
        BUY_WITH_STARS: [
          { target: 'processingPurchase', guard: 'hasEnoughStars' },
          { target: 'insufficientFunds' }
        ],
        // Попытка забрать за Стрик (если это награда за достижение)
        CLAIM_BY_STREAK: [
          { target: 'processingPurchase', guard: 'hasEnoughStreak' },
          { target: 'lockConditionsNotMet' }
        ],
        BACK: 'idle'
      }
    },

    // 4. ПРОЦЕСС ПОКУПКИ
    processingPurchase: {
      invoke: {
        src: 'handlePurchaseInDB',
        onDone: { 
          target: 'purchaseSuccess',
          actions: ['deductStars', 'notifyAdminAboutReward'] // Уведомляет ВАС в телеграм!
        },
        onError: 'idle'
      }
    },

    // 5. УСПЕХ: Красивая анимация
    purchaseSuccess: {
      on: { CONFIRM: 'idle' }
    },

    insufficientFunds: {
      on: { BACK: 'itemDetails' }
    },

    lockConditionsNotMet: {
      on: { BACK: 'itemDetails' }
    },

    finished: {
      type: 'final'
    }
  }
});

import { setup, assign } from 'xstate';

/**
 * 105_PLAYER_SHOP_MACHINE
 * 
 * Внутриигровой Магазин Игрока. 
 * Игрок тратит заработанное "Тренировочное Золото" на награды:
 * Скипы тренировок, Аватарки, Лутбоксы, Троллинг Ответственного, Режим Хардкора.
 */

export const playerShopMachine = setup({
  types: {
    context: {} as {
      playerId: string;
      playerBalance: number;
      selectedItem: string | null;
      selectedItemPrice: number | null;
    },
    events: {} as
      | { type: 'SELECT_ITEM'; itemId: string; price: number }
      | { type: 'CANCEL' }
      | { type: 'CONFIRM_PURCHASE' }
      | { type: 'PURCHASE_SUCCESS'; newBalance: number }
      | { type: 'BACK_TO_GATE' } // Выход из магазина
  },
  actions: {
    selectItem: assign({
      selectedItem: ({ event }) => event.type === 'SELECT_ITEM' ? event.itemId : null,
      selectedItemPrice: ({ event }) => event.type === 'SELECT_ITEM' ? event.price : null
    }),
    clearSelection: assign({
      selectedItem: null,
      selectedItemPrice: null
    }),
    updateBalance: assign({
      playerBalance: ({ event }) => event.type === 'PURCHASE_SUCCESS' ? event.newBalance : 0
    })
  },
  guards: {
    hasEnoughFunds: ({ context }) => {
      if (context.selectedItemPrice === null) return false;
      return context.playerBalance >= context.selectedItemPrice;
    }
  }
}).createMachine({
  id: 'playerShopMachine',
  initial: 'browsingShop',
  context: {
    playerId: 'user_1',
    playerBalance: 0,
    selectedItem: null,
    selectedItemPrice: null
  },
  states: {
    browsingShop: {
      meta: { "@statelyai.color": "blue" },
      on: {
        SELECT_ITEM: { target: 'confirmingPurchase', actions: 'selectItem' },
        BACK_TO_GATE: 'exitShop'
      }
    },
    confirmingPurchase: {
      meta: { "@statelyai.color": "orange" },
      always: [
        { target: 'insufficientFunds', guard: ({ context }) => !context.selectedItemPrice || context.playerBalance < context.selectedItemPrice }
      ],
      on: {
        CONFIRM_PURCHASE: 'processingPurchase',
        CANCEL: { target: 'browsingShop', actions: 'clearSelection' }
      }
    },
    insufficientFunds: {
      meta: { "@statelyai.color": "red" },
      on: { CANCEL: { target: 'browsingShop', actions: 'clearSelection' } }
    },
    processingPurchase: {
      meta: { "@statelyai.color": "yellow" },
      invoke: {
        // @ts-ignore
        src: 'deductBalanceAndGrantItem',
        onDone: { target: 'purchaseSuccess', actions: ['updateBalance', 'clearSelection'] },
        onError: { target: 'browsingShop', actions: 'clearSelection' }
      }
    },
    purchaseSuccess: {
      meta: { "@statelyai.color": "green" },
      on: { CANCEL: 'browsingShop' } // Кнопка "Ок / Назад в магазин" после успешной покупки
    },
    exitShop: {
      meta: { "@statelyai.color": "gray" },
      type: 'final' // Возвращает контроль в 103_workoutGateMachine
    }
  }
});

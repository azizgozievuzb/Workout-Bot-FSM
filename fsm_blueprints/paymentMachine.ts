import { setup, assign } from 'xstate';

/**
 * УНИВЕРСАЛЬНАЯ МАШИНА ОПЛАТЫ (Payment Machine v2)
 * 
 * ПОДДЕРЖИВАЕМЫЕ МЕТОДЫ:
 * 1. Промокоды (Тестовый режим)
 * 2. HOT PAY (NEAR Protocol / Crypto) - Через итенты
 * 3. Telegram Stars (В планах)
 */

export const paymentMachine = setup({
  types: {
    context: {} as {
      method: 'none' | 'promo' | 'hotpay' | 'stars';
      enteredCode: string;
      transactionId: string | null;
      errorMessage: string | null;
    },
    events: {} as
      | { type: 'CHOOSE_METHOD'; method: 'promo' | 'hotpay' | 'stars' }
      | { type: 'TYPE_CODE'; code: string }
      | { type: 'SUBMIT_PROMO' }
      | { type: 'START_HOTPAY' }
      | { type: 'HOTPAY_WEBHOOK_RECEIVED'; txId: string }
      | { type: 'CANCEL' }
  },
  actions: {
    setMethod: assign({ method: ({ event }) => event.type === 'CHOOSE_METHOD' ? event.method : 'none' }),
    assignCode: assign({ enteredCode: ({ event }) => event.type === 'TYPE_CODE' ? event.code : '' }),
    assignTx: assign({ transactionId: ({ event }) => event.type === 'HOTPAY_WEBHOOK_RECEIVED' ? event.txId : null }),
    setError: assign({ errorMessage: "Ошибка платежа. Попробуйте снова или свяжитесь с поддержкой." }),
    clearError: assign({ errorMessage: null, method: 'none' })
  }
}).createMachine({
  id: 'paymentMachine',
  initial: 'methodSelection',
  context: {
    method: 'none',
    enteredCode: '',
    transactionId: null,
    errorMessage: null,
  },
  states: {
    // 1. Экран выбора способа оплаты
    methodSelection: {
      on: {
        CHOOSE_METHOD: [
          { target: 'promoCodeInput', guard: ({ event }) => event.method === 'promo' },
          { target: 'waitingForHotPay', guard: ({ event }) => event.method === 'hotpay' }
        ]
      }
    },
    // 2. Ветка промокодов
    promoCodeInput: {
      on: {
        TYPE_CODE: { actions: 'assignCode' },
        SUBMIT_PROMO: { target: 'validatingPromo' },
        CANCEL: { target: 'methodSelection' }
      }
    },
    validatingPromo: {
      invoke: {
        src: 'checkPromoInDB',
        onDone: { target: 'success' },
        onError: { target: 'promoCodeInput', actions: 'setError' }
      }
    },
    // 3. Ветка HOT PAY (NEAR Protocol)
    waitingForHotPay: {
      entry: 'initiateHotPayIntent', // Открываем виджет/ссылку HOT Wallet
      on: {
        HOTPAY_WEBHOOK_RECEIVED: {
          target: 'success',
          actions: 'assignTx'
        },
        CANCEL: { target: 'methodSelection' }
      }
    },
    success: { type: 'final' }
  }
});

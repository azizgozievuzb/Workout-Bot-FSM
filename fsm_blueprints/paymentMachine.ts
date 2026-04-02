import { setup, assign } from 'xstate';

/**
 * УНИВЕРСАЛЬНАЯ МАШИНА ОПЛАТЫ (Payment Machine v3 - FULL)
 * 
 * ПОДДЕРЖИВАЕМЫЕ МЕТОДЫ:
 * 1. Промокоды (Тестовый режим)
 * 2. HOT PAY (NEAR Protocol / Crypto)
 * 3. Telegram Stars (Встроенная оплата AppStore/PlayStore)
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
      | { type: 'START_STARS' }
      | { type: 'STARS_PAYMENT_RECEIVED' } 
      | { type: 'HOTPAY_WEBHOOK_RECEIVED'; txId: string }
      | { type: 'CANCEL' }
  },
  actions: {
    setMethod: assign({ method: ({ event }) => event.type === 'CHOOSE_METHOD' ? event.method : 'none' }),
    assignCode: assign({ enteredCode: ({ event }) => event.type === 'TYPE_CODE' ? event.code : '' }),
    assignTx: assign({ transactionId: ({ event }) => event.type === 'HOTPAY_WEBHOOK_RECEIVED' ? event.txId : null }),
    setError: assign({ errorMessage: "Оплата не удалась. Попробуйте еще раз." }),
    clearError: assign({ errorMessage: null })
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
    // 1. Экран выбора способа оплаты (3 Кнопки)
    methodSelection: {
      on: {
        CHOOSE_METHOD: [
          { target: 'promoCodeInput', guard: ({ event }) => event.method === 'promo' },
          { target: 'waitingForHotPay', guard: ({ event }) => event.method === 'hotpay' },
          { target: 'waitingForStars', guard: ({ event }) => event.method === 'stars' }
        ]
      }
    },
    // Ветка ПРОМОКОДОВ
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
    // Ветка HOT PAY (NEAR Crypto)
    waitingForHotPay: {
      entry: 'initiateHotPayIntent',
      on: {
        HOTPAY_WEBHOOK_RECEIVED: { target: 'success', actions: 'assignTx' },
        CANCEL: { target: 'methodSelection' }
      }
    },
    // Ветка TELEGRAM STARS
    waitingForStars: {
      entry: 'createStarsInvoice', // Генерируем инвойс через API Telegram
      on: {
        STARS_PAYMENT_RECEIVED: { target: 'success' },
        CANCEL: { target: 'methodSelection' }
      }
    },
    success: { type: 'final' }
  }
});

import { setup, assign } from 'xstate';

/**
 * ПЛАТЕЖНАЯ МАШИНА (Clean Visual Version)
 * 
 * Очищенная структура для корректного отображения в Stately без "каши".
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
      | { type: 'USE_PROMOCODE' }
      | { type: 'USE_HOTPAY' }
      | { type: 'USE_STARS' }
      | { type: 'TYPE_CODE'; code: string }
      | { type: 'SUBMIT_PROMO' }
      | { type: 'STARS_PAYMENT_RECEIVED' } 
      | { type: 'HOTPAY_WEBHOOK_RECEIVED'; txId: string }
      | { type: 'BACK' }
  },
  actions: {
    assignCode: assign({ enteredCode: ({ event }) => event.type === 'TYPE_CODE' ? event.code : '' }),
    assignTx: assign({ transactionId: ({ event }) => event.type === 'HOTPAY_WEBHOOK_RECEIVED' ? event.txId : null }),
    setError: assign({ errorMessage: "Ошибка платежа. Попробуйте снова." }),
    clearContext: assign({ method: 'none', errorMessage: null, enteredCode: '' })
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
    // Центральный узел
    methodSelection: {
      on: {
        USE_PROMOCODE: 'promoCodeInput',
        USE_HOTPAY: 'waitingForHotPay',
        USE_STARS: 'waitingForStars'
      }
    },
    // Ветка 1: Промокоды
    promoCodeInput: {
      on: {
        TYPE_CODE: { actions: 'assignCode' },
        SUBMIT_PROMO: 'validatingPromo',
        BACK: 'methodSelection'
      }
    },
    validatingPromo: {
      invoke: {
        src: 'checkPromoInDB',
        onDone: 'success',
        onError: { target: 'promoCodeInput', actions: 'setError' }
      }
    },
    // Ветка 2: HOT PAY
    waitingForHotPay: {
      on: {
        HOTPAY_WEBHOOK_RECEIVED: { target: 'success', actions: 'assignTx' },
        BACK: 'methodSelection'
      }
    },
    // Ветка 3: Telegram Stars
    waitingForStars: {
      on: {
        STARS_PAYMENT_RECEIVED: 'success',
        BACK: 'methodSelection'
      }
    },
    // Финальное состояние
    success: {
      type: 'final'
    }
  }
});

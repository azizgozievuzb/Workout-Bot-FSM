import { setup, assign } from 'xstate';

/**
 * PAYMENT MACHINE v4 (Final Visual Clean)
 * 
 * Группируем состояния для идеального рендеринга в Stately.
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
      | { type: 'STARS_SUCCESS' } 
      | { type: 'HOTPAY_SUCCESS'; txId: string }
      | { type: 'BACK' }
  },
  actions: {
    assignCode: assign({ enteredCode: ({ event }) => event.type === 'TYPE_CODE' ? event.code : '' }),
    assignTx: assign({ transactionId: ({ event }) => event.type === 'HOTPAY_SUCCESS' ? event.txId : null }),
    setError: assign({ errorMessage: "Error occurred" }),
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
    // Главное меню выбора
    methodSelection: {
      on: {
        USE_PROMOCODE: { target: 'promoCodeBranch' },
        USE_HOTPAY: { target: 'hotpayBranch' },
        USE_STARS: { target: 'starsBranch' }
      }
    },

    // Ветка 1: Промокод (Изолированный блок)
    promoCodeBranch: {
      initial: 'input',
      states: {
        input: {
          on: {
            TYPE_CODE: { actions: 'assignCode' },
            SUBMIT_PROMO: { target: 'validating' },
            BACK: { target: '#paymentMachine.methodSelection' }
          }
        },
        validating: {
          invoke: {
            src: 'checkPromoInDB',
            onDone: { target: '#paymentMachine.success' },
            onError: { target: 'input', actions: 'setError' }
          }
        }
      }
    },

    // Ветка 2: HOT PAY
    hotpayBranch: {
      initial: 'waiting',
      states: {
        waiting: {
          on: {
            HOTPAY_SUCCESS: { target: '#paymentMachine.success', actions: 'assignTx' },
            BACK: { target: '#paymentMachine.methodSelection' }
          }
        }
      }
    },

    // Ветка 3: Stars
    starsBranch: {
      initial: 'waiting',
      states: {
        waiting: {
          on: {
            STARS_SUCCESS: { target: '#paymentMachine.success' },
            BACK: { target: '#paymentMachine.methodSelection' }
          }
        }
      }
    },

    // Единый финиш
    success: {
      type: 'final'
    }
  }
});

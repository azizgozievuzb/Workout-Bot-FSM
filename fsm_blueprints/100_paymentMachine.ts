import { setup, assign } from 'xstate';

/**
 * PAYMENT MACHINE v5 (Strict Vertical Logic)
 * 
 * Используем ту же структуру, что и в rootMachine для идеальной визуализации.
 */

export const paymentMachine = setup({
  types: {
    context: {} as {
      enteredCode: string;
      errorMessage: string | null;
    },
    events: {} as
      | { type: 'CHOOSE_PROMO' }
      | { type: 'CHOOSE_HOTPAY' }
      | { type: 'CHOOSE_STARS' }
      | { type: 'TYPE_CODE'; code: string }
      | { type: 'SUBMIT_PROMO' }
      | { type: 'HOTPAY_SUCCESS' }
      | { type: 'STARS_SUCCESS' }
      | { type: 'BACK' }
  },
  actions: {
    assignCode: assign({ enteredCode: ({ event }) => event.type === 'TYPE_CODE' ? event.code : '' }),
    setError: assign({ errorMessage: "Error!" })
  }
}).createMachine({
  id: 'paymentMachine',
  initial: 'idle',
  context: {
    enteredCode: '',
    errorMessage: null,
  },
  states: {
    // 💡 Главный узел ожидания (как в Root)
    idle: {
      on: {
        CHOOSE_PROMO: 'promoPhase',
        CHOOSE_HOTPAY: 'hotpayPhase',
        CHOOSE_STARS: 'starsPhase'
      }
    },
    // ✅ Ветка 1 (Вертикально)
    promoPhase: {
      on: {
        TYPE_CODE: { actions: 'assignCode' },
        SUBMIT_PROMO: 'validatingPromo',
        BACK: 'idle'
      }
    },
    validatingPromo: {
      invoke: {
        // @ts-ignore
        src: 'checkPromo',
        onDone: 'success',
        onError: { target: 'promoPhase', actions: 'setError' }
      }
    },
    // ✅ Ветка 2 (Вертикально)
    hotpayPhase: {
      on: {
        HOTPAY_SUCCESS: 'success',
        BACK: 'idle'
      }
    },
    // ✅ Ветка 3 (Вертикально)
    starsPhase: {
      on: {
        STARS_SUCCESS: 'success',
        BACK: 'idle'
      }
    },
    success: {
      type: 'final'
    }
  }
});

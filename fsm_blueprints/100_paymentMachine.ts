import { setup, assign } from 'xstate';

/**
 * PAYMENT MACHINE v6 (Strict Vertical Logic)
 *
 * starsPhase expanded 1:1 with the frontend Telegram Stars flow (task 7.4):
 *   creatingInvoice → invoiceOpen → verifying → success | failure
 *
 * The Telegram openInvoice callback status is NOT the source of truth — after 'paid'
 * we poll our own backend (GET /payments/{id}) and only 'fulfilled' means success.
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
      | { type: 'INVOICE_CREATED' }      // backend returned invoice_link → openInvoice
      | { type: 'INVOICE_PAID' }         // Telegram callback status === 'paid'
      | { type: 'INVOICE_CANCELLED' }    // status === 'cancelled'
      | { type: 'VERIFY_FULFILLED' }     // GET /payments/{id} === 'fulfilled'
      | { type: 'VERIFY_FAILED' }        // status === 'failed' | 'refunded'
      | { type: 'VERIFY_TIMEOUT' }       // poll exceeded 30s
      | { type: 'RETRY' }
      | { type: 'BACK' }
  },
  actions: {
    assignCode: assign({ enteredCode: ({ event }) => event.type === 'TYPE_CODE' ? event.code : '' }),
    setError: assign({ errorMessage: "Error!" }),
    clearError: assign({ errorMessage: null }),
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
    // ✅ Ветка 3 — Telegram Stars (развёрнутый флоу)
    starsPhase: {
      initial: 'creatingInvoice',
      on: { BACK: 'idle' },
      states: {
        // POST /payments/invoice — цена только из star_products, снапшот на payment
        creatingInvoice: {
          entry: 'clearError',
          invoke: {
            // @ts-ignore
            src: 'createInvoice',
            onDone: 'invoiceOpen',
            onError: { target: 'failure', actions: 'setError' }
          }
        },
        // Telegram WebApp.openInvoice(invoice_link) открыт, ждём callback
        invoiceOpen: {
          on: {
            INVOICE_PAID: 'verifying',
            INVOICE_CANCELLED: { target: 'failure', actions: 'setError' }
          }
        },
        // Поллинг GET /payments/{id} каждые 2с до 30с. Истина — только статус в нашей БД.
        verifying: {
          on: {
            VERIFY_FULFILLED: '#paymentMachine.success',
            VERIFY_FAILED: { target: 'failure', actions: 'setError' },
            VERIFY_TIMEOUT: { target: 'failure', actions: 'setError' }
          }
        },
        // Оплата не прошла / отменена / таймаут — можно повторить или выйти
        failure: {
          on: {
            RETRY: 'creatingInvoice',
            BACK: '#paymentMachine.idle'
          }
        }
      }
    },
    success: {
      type: 'final'
    }
  }
});

import { setup, assign } from 'xstate';

/**
 * PAYMENT MACHINE v7 (task 7.5 — «Всё через Stars»)
 *
 * Промокоды как способ оплаты и hotpay удалены. Единственная оплата — Telegram Stars.
 * Пользователь выбирает тариф + период (первый платёж = intro, без купона; продление =
 * 1m/3m/12m + необязательный купон), затем идёт разворачиваемый Stars-флоу:
 *   selecting → creatingInvoice → invoiceOpen → verifying → success | failure
 *
 * Истина оплаты — статус в нашей БД (GET /payments/{id} === 'fulfilled'), НЕ callback Telegram.
 * Вся валидация цен/периодов/купонов — только на сервере (POST /payments/tier-invoice).
 */

type Tier = 'standard' | 'premium' | 'elite';
type Period = 'intro' | '1m' | '3m' | '12m';

export const paymentMachine = setup({
  types: {
    context: {} as {
      tier: Tier | null;
      period: Period | null;
      couponCode: string | null;
      isFirstPayment: boolean;
      errorMessage: string | null;
    },
    events: {} as
      | { type: 'SELECT_TIER'; tier: Tier }
      | { type: 'SELECT_PERIOD'; period: Period }
      | { type: 'ENTER_COUPON'; code: string }
      | { type: 'CLEAR_COUPON' }
      | { type: 'PAY' }                  // POST /payments/tier-invoice
      | { type: 'INVOICE_CREATED' }      // backend returned invoice_link → openInvoice
      | { type: 'INVOICE_PAID' }         // Telegram callback status === 'paid'
      | { type: 'INVOICE_CANCELLED' }    // status === 'cancelled'
      | { type: 'VERIFY_FULFILLED' }     // GET /payments/{id} === 'fulfilled'
      | { type: 'VERIFY_FAILED' }        // status === 'failed' | 'refunded'
      | { type: 'VERIFY_TIMEOUT' }       // poll exceeded ~30s
      | { type: 'RETRY' }
      | { type: 'BACK' }
  },
  actions: {
    assignTier: assign({ tier: ({ event }) => event.type === 'SELECT_TIER' ? event.tier : null }),
    assignPeriod: assign({ period: ({ event }) => event.type === 'SELECT_PERIOD' ? event.period : null }),
    assignCoupon: assign({ couponCode: ({ event }) => event.type === 'ENTER_COUPON' ? event.code : null }),
    clearCoupon: assign({ couponCode: null }),
    setError: assign({ errorMessage: 'Error!' }),
    clearError: assign({ errorMessage: null }),
  },
  guards: {
    canPay: ({ context }) => context.tier !== null && context.period !== null,
  }
}).createMachine({
  id: 'paymentMachine',
  initial: 'selecting',
  context: {
    tier: null,
    period: null,
    couponCode: null,
    isFirstPayment: true,
    errorMessage: null,
  },
  states: {
    // Выбор тарифа/периода/купона. Первый платёж — только intro без купона (валидирует сервер).
    selecting: {
      entry: 'clearError',
      on: {
        SELECT_TIER: { actions: 'assignTier' },
        SELECT_PERIOD: { actions: 'assignPeriod' },
        ENTER_COUPON: { actions: 'assignCoupon' },
        CLEAR_COUPON: { actions: 'clearCoupon' },
        PAY: { target: 'creatingInvoice', guard: 'canPay' },
        BACK: 'aborted'
      }
    },
    // POST /payments/tier-invoice — цена/период/купон только с сервера, снапшот на payment.
    creatingInvoice: {
      entry: 'clearError',
      invoke: {
        // @ts-ignore
        src: 'createTierInvoice',
        onDone: 'invoiceOpen',
        onError: { target: 'failure', actions: 'setError' }
      }
    },
    // Telegram WebApp.openInvoice(invoice_link) открыт, ждём callback.
    invoiceOpen: {
      on: {
        INVOICE_PAID: 'verifying',
        INVOICE_CANCELLED: { target: 'failure', actions: 'setError' }
      }
    },
    // Поллинг GET /payments/{id} до ~30с. Истина — только статус в нашей БД.
    verifying: {
      on: {
        VERIFY_FULFILLED: 'success',
        VERIFY_FAILED: { target: 'failure', actions: 'setError' },
        VERIFY_TIMEOUT: { target: 'failure', actions: 'setError' }
      }
    },
    failure: {
      on: {
        RETRY: 'creatingInvoice',
        BACK: 'selecting'
      }
    },
    success: { type: 'final' },
    aborted: { type: 'final' }
  }
});

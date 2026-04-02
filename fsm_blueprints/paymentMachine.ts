import { setup, assign } from 'xstate';

/**
 * МАШИНА ОПЛАТЫ И АКТИВАЦИИ КОДОВ (Payment Machine)
 * 
 * ПРИНЦИПЫ:
 * - Изоляция: Логика промокодов не мешает тренировкам.
 * - Проверка на сервере: Код проверяется в БД в реальном времени.
 */

export const paymentMachine = setup({
  types: {
    context: {} as {
      enteredCode: string;
      errorMessage: string | null;
    },
    events: {} as
      | { type: 'TYPE_CODE'; code: string }
      | { type: 'SUBMIT_CODE' }
      | { type: 'CANCEL' }
  },
  actions: {
    assignCode: assign({
      enteredCode: ({ event }) => (event.type === 'TYPE_CODE' ? event.code : '')
    }),
    setError: assign({
      errorMessage: "Неверный или просроченный код. Попробуйте еще раз."
    }),
    clearError: assign({
      errorMessage: null
    })
  }
}).createMachine({
  id: 'paymentMachine',
  initial: 'idle',
  context: {
    enteredCode: '',
    errorMessage: null,
  },
  states: {
    // Ждем, пока пользователь введет код
    idle: {
      on: {
        TYPE_CODE: {
          actions: ['assignCode', 'clearError']
        },
        SUBMIT_CODE: {
          target: 'validatingCode'
        },
        CANCEL: {
          target: 'cancelled'
        }
      }
    },
    // Проверка кода в базе данных (Supabase)
    validatingCode: {
      invoke: {
        src: 'checkPromoCodeInDB',
        onDone: {
          target: 'success'
        },
        onError: {
          target: 'idle',
          actions: 'setError'
        }
      }
    },
    // Успешная активация
    success: {
      type: 'final'
    },
    // Отмена оплаты
    cancelled: {
      type: 'final'
    }
  }
});

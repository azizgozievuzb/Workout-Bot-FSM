import { setup, assign } from 'xstate';

/**
 * 104_RESPONSIBLE_MACHINE
 * 
 * Главный экран Ответственного (Второй Половинки).
 * Доступ сюда дается после успешной привязки и оплаты первоначального доступа.
 * Функционал: Мониторинг партнера, покупка Бустов X2 за Звезды, Пинги-напоминалки (раз в 6 часов).
 */

export const responsibleMachine = setup({
  types: {
    context: {} as {
      responsibleId: string;
      playerId: string;
      playerGlobalScore: number;
      playerThreeDayScore: number;
      activeBoost: '1_day' | '1_week' | null;
      lastPingTimestamp: number | null; 
    },
    events: {} as
      | { type: 'REFRESH_STATS'; stats: any }
      | { type: 'OPEN_SHOP' }
      | { type: 'BUY_DAY_BOOST' } // 50 Telegram Stars
      | { type: 'BUY_WEEK_BOOST' } // 300 Telegram Stars
      | { type: 'SEND_PING' }
      | { type: 'PAYMENT_SUCCESS'; boostType: '1_day' | '1_week' }
      | { type: 'PAYMENT_CANCEL' }
      | { type: 'BACK' }
  },
  actions: {
    updateStats: assign({
      playerGlobalScore: ({ event }) => event.stats.globalScore,
      playerThreeDayScore: ({ event }) => event.stats.threeDayScore,
      activeBoost: ({ event }) => event.stats.activeBoost,
      lastPingTimestamp: ({ event }) => event.stats.lastPingTimestamp
    }),
    recordPingToken: assign({
      lastPingTimestamp: () => Date.now()
    }),
    applyBoost: assign({
      activeBoost: ({ event }) => event.type === 'PAYMENT_SUCCESS' ? event.boostType : null
    })
  },
  guards: {
    canSendPing: ({ context }) => {
      // Разрешено, если пинга еще не было, ИЛИ прошло больше 6 часов
      if (!context.lastPingTimestamp) return true;
      const sixHoursInMs = 6 * 60 * 60 * 1000;
      return (Date.now() - context.lastPingTimestamp) >= sixHoursInMs;
    }
  }
}).createMachine({
  id: 'responsibleMachine',
  initial: 'fetchingPartnerStats',
  context: {
    responsibleId: 'resp_1',
    playerId: 'player_1',
    playerGlobalScore: 0,
    playerThreeDayScore: 0,
    activeBoost: null,
    lastPingTimestamp: null
  },
  states: {
    // =============================
    // Загрузка свежих данных Игрока
    // =============================
    fetchingPartnerStats: {
      meta: { "@statelyai.color": "blue" },
      invoke: {
        src: 'fetchPlayerStatsFromDB',
        onDone: { target: 'responsibleDashboard', actions: 'updateStats' },
        onError: 'responsibleDashboard' // fallback, если ошибка сети
      }
    },

    // =============================
    // Главное меню (Дашборд)
    // =============================
    responsibleDashboard: {
      meta: { "@statelyai.color": "green" },
      on: {
        OPEN_SHOP: 'boostShop',
        SEND_PING: [
          { target: 'sendingPush', guard: 'canSendPing' },
          { target: 'pingCooldownError' } // Пользователь спамит кнопкой до истечения 6 часов
        ],
        REFRESH_STATS: { target: 'fetchingPartnerStats' }
      }
    },

    // =============================
    // Мотивация партнера (Пинг)
    // =============================
    sendingPush: {
      meta: { "@statelyai.color": "purple" },
      invoke: {
        src: 'sendPushToPlayer',
        onDone: { target: 'responsibleDashboard', actions: 'recordPingToken' },
        onError: 'responsibleDashboard'
      }
    },
    pingCooldownError: {
      meta: { "@statelyai.color": "red" },
      on: { BACK: 'responsibleDashboard' } // Сообщение: "Кулдаун 6 часов. Партнер уже уведомлен ранее!"
    },

    // =============================
    // Магазин Бустов (X2 Золото)
    // =============================
    boostShop: {
      meta: { "@statelyai.color": "orange" },
      on: {
        BUY_DAY_BOOST: 'processingPayment', // Цена: 50 Stars
        BUY_WEEK_BOOST: 'processingPayment', // Цена: 300 Stars
        BACK: 'responsibleDashboard'
      }
    },

    processingPayment: {
      meta: { "@statelyai.color": "yellow" },
      invoke: {
        src: 'telegramStarsPayment'
      },
      on: {
        PAYMENT_SUCCESS: { target: 'boostActivatedMsg', actions: 'applyBoost' },
        PAYMENT_CANCEL: 'boostShop'
      }
    },

    boostActivatedMsg: {
      meta: { "@statelyai.color": "green" },
      on: { BACK: 'responsibleDashboard' } // "Успешно! Ваш партнер теперь зарабатывает X2."
    }
  }
});

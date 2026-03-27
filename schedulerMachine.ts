import { createMachine } from 'xstate';

/**
 * SchedulerMachine: Фоновый планировщик.
 * Напоминания, сброс дневного лимита и стриков.
 */
export const schedulerMachine = createMachine({
  id: 'Scheduler',
  initial: 'running',
  states: {
    running: {
      on: {
        // Срабатывает в 00:00 (Cron Job / Supabase Edge Function)
        MIDNIGHT_TICK: {
          target: 'midnightReset',
          actions: 'logMidnightEvent'
        },
        // Срабатывает вечером (например, в 20:00)
        EVENING_TICK: {
          target: 'eveningReminder',
          actions: 'logEveningEvent'
        }
      }
    },

    // 1. ПОЛУНОЧНЫЙ СБРОС
    midnightReset: {
      initial: 'resetDailyFlag',
      states: {
        // Сбросить флаг "hasDoneToday" для всех пользователей
        resetDailyFlag: {
          invoke: {
            src: 'resetAllDailyFlags',
            onDone: 'checkStreaks'
          }
        },
        // Проверить, кто НЕ тренировался вчера — обнулить их стрик
        checkStreaks: {
          invoke: {
            src: 'breakInactiveStreaks',
            onDone: '#Scheduler.running'
          }
        }
      }
    },

    // 2. ВЕЧЕРНЕЕ НАПОМИНАНИЕ
    eveningReminder: {
      initial: 'findLazyUsers',
      states: {
        // Найти всех, кто ещё не тренировался сегодня
        findLazyUsers: {
          invoke: {
            src: 'fetchUsersWithoutWorkoutToday',
            onDone: 'sendReminders'
          }
        },
        // Отправить мотивирующее сообщение
        sendReminders: {
          invoke: {
            src: 'sendTelegramReminders',
            onDone: '#Scheduler.running'
          }
        }
      }
    }
  }
});

import { createMachine, assign } from 'xstate';

/**
 * OnboardingMachine: Первый вход в систему.
 * Собирает роль, ласковое имя, Telegram-ник, связывает пары.
 * Дает стартовый бонус 50⭐️ для Игрока.
 */
export const onboardingMachine = createMachine({
  id: 'Onboarding',
  initial: 'welcome',
  context: {
    role: null as 'RESPONSIBLE' | 'PLAYER' | null,
    nickname: '',
    petName: '', // Как ласково называть (для ИИ-комплиментов)
    telegramNick: '',
    email: '',
    inviteCode: ''
  },
  states: {
    // 0. Приветствие
    welcome: {
      on: { CONTINUE: 'askRole' }
    },

    // 1. Выбор роли
    askRole: {
      on: {
        I_AM_PLAYER: { target: 'askNickname', actions: assign({ role: 'PLAYER' }) },
        I_AM_RESPONSIBLE: { target: 'askTelegramNick', actions: assign({ role: 'RESPONSIBLE' }) }
      }
    },

    // --- ВЕТКА ИГРОКА ---

    // 2a. Как тебя зовут?
    askNickname: {
      on: {
        SET_NICKNAME: {
          target: 'askPetName',
          actions: assign({ nickname: ({ event }: any) => event.value })
        }
      }
    },

    // 3a. Как тебя ласково называть? (для Gemini AI)
    askPetName: {
      on: {
        SET_PET_NAME: {
          target: 'enterInviteCode',
          actions: assign({ petName: ({ event }: any) => event.value })
        }
      }
    },

    // 4a. Код приглашения (от Ответственного или Админа)
    enterInviteCode: {
      on: {
        SUBMIT_CODE: {
          target: 'linkingPair',
          actions: assign({ inviteCode: ({ event }: any) => event.code })
        }
      }
    },

    // --- ВЕТКА ОТВЕТСТВЕННОГО ---

    // 2b. Telegram-ник (для уведомлений)
    askTelegramNick: {
      on: {
        SET_NICK: {
          target: 'askResponsibleEmail',
          actions: assign({ telegramNick: ({ event }: any) => event.value })
        }
      }
    },

    // 3b. Email (для дублирования уведомлений)
    askResponsibleEmail: {
      on: {
        SET_EMAIL: {
          target: 'linkingPair',
          actions: assign({ email: ({ event }: any) => event.value })
        },
        SKIP: 'linkingPair'
      }
    },

    // --- ОБЩИЙ БЛОК ---

    // 5. Связка пары в БД
    linkingPair: {
      invoke: {
        src: 'linkCoupleInDB',
        onDone: 'grantBonus',
        onError: 'enterInviteCode'
      }
    },

    // 6. Стартовый бонус (50⭐️ для Игрока)
    grantBonus: {
      entry: 'grantStarterBonus',
      always: 'completed'
    },

    // 7. Готово!
    completed: {
      type: 'final'
    }
  }
});

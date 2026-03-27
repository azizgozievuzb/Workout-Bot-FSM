import { createMachine, assign } from 'xstate';

/**
 * OnboardingMachine: Первый вход в систему.
 * Собирает роли, предпочтения и ласковые имена для ИИ.
 */
export const onboardingMachine = createMachine({
  id: 'Onboarding',
  initial: 'askRole',
  context: {
    role: null as 'RESPONSIBLE' | 'PLAYER' | null,
    nickname: '', // Как называть в чате
    partnerId: null as string | null, // Связка с парой
    email: '' // Для уведомлений ответственного
  },
  states: {
    // 1. Кто зашел?
    askRole: {
      on: {
        I_AM_PLAYER: { target: 'askNickname', actions: assign({ role: 'PLAYER' }) },
        I_AM_RESPONSIBLE: { target: 'askEmail', actions: assign({ role: 'RESPONSIBLE' }) }
      }
    },

    // 2. Для девушки: Как тебя называть?
    askNickname: {
      on: {
        SET_NICKNAME: { 
          target: 'linkingToPartner', 
          actions: assign({ nickname: ({ event }: any) => event.value }) 
        }
      }
    },

    // 3. Для парня: Почта для уведомлений
    askEmail: {
      on: {
        SET_EMAIL: { 
          target: 'linkingToPartner', 
          actions: assign({ email: ({ event }: any) => event.value }) 
        }
      }
    },

    // 4. Связка пары (через код приглашения или по списку админа)
    linkingToPartner: {
      invoke: {
        src: 'linkCoupleInDB',
        onDone: 'completed',
        onError: 'askRole'
      }
    },

    completed: {
      type: 'final'
    }
  }
});

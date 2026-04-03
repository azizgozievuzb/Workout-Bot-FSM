import { setup, assign } from 'xstate';

/**
 * 101_ONBOARDING_MACHINE
 * 
 * Идеальная матрешка регистрации: вызывается из 000_rootMachine для любого нового пользователя.
 * После её завершения (пользователь выбрал язык, роль, привязал партнера) контроль возвращается в родителя.
 */

export const onboardingMachine = setup({
  types: {
    context: {} as {
      lang: 'ru' | 'uz' | 'en' | null;
      role: 'player' | 'responsible' | null;
      gender: 'male' | 'female' | null;
      startingWindow: [number, number, number] | null; 
      pairingCode: string | null;
    },
    events: {} as
      | { type: 'SET_LANG'; lang: 'ru' | 'uz' | 'en' }
      | { type: 'SET_ROLE'; role: 'player' | 'responsible' }
      | { type: 'SET_GENDER'; gender: 'male' | 'female' }
      | { type: 'SURVEY_ANSWER' } 
      | { type: 'SURVEY_COMPLETE'; window: [number, number, number] }
      | { type: 'PAIRING_CODE_CREATED'; code: string }
      | { type: 'ENTER_PAIRING_CODE'; code: string }
      | { type: 'PAIRING_SUCCESS' } 
  },
  actions: {
    assignLang: assign({ lang: ({ event }) => event.type === 'SET_LANG' ? event.lang : null }),
    assignRole: assign({ role: ({ event }) => event.type === 'SET_ROLE' ? event.role : null }),
    assignGender: assign({ gender: ({ event }) => event.type === 'SET_GENDER' ? event.gender : null }),
    assignWindow: assign({ startingWindow: ({ event }) => event.type === 'SURVEY_COMPLETE' ? event.window : null }),
    assignCode: assign({ pairingCode: ({ event }) => event.type === 'PAIRING_CODE_CREATED' ? event.code : null })
  },
  guards: {
    isPlayer: ({ context }) => context.role === 'player',
    isResponsible: ({ context }) => context.role === 'responsible'
  }
}).createMachine({
  id: 'onboardingMachine',
  initial: 'languageSelection',
  context: {
    lang: null,
    role: null,
    gender: null,
    startingWindow: null,
    pairingCode: null
  },
  states: {
    languageSelection: {
      meta: { "@statelyai.color": "blue" },
      on: { SET_LANG: { target: 'roleSelection', actions: 'assignLang' } }
    },
    roleSelection: {
      meta: { "@statelyai.color": "blue" },
      on: { SET_ROLE: { target: 'genderSelection', actions: 'assignRole' } }
    },
    genderSelection: {
      meta: { "@statelyai.color": "blue" },
      on: { 
        SET_GENDER: { 
          target: 'roleRouting', 
          actions: 'assignGender' 
        } 
      }
    },
    roleRouting: {
      always: [
        { target: 'playerSurvey', guard: 'isPlayer' },
        { target: 'responsiblePairing', guard: 'isResponsible' }
      ]
    },
    
    // ===================================
    // ВЕТКА ИГРОКА
    // ===================================
    playerSurvey: {
      meta: { "@statelyai.color": "yellow" },
      on: {
        SURVEY_ANSWER: 'playerSurvey', // Можно крутиться тут, отвечая на вопросы
        SURVEY_COMPLETE: { target: 'playerPairing', actions: 'assignWindow' } // Бэкенд возвращает стартовое окно
      }
    },
    playerPairing: {
      meta: { "@statelyai.color": "orange" },
      invoke: {
        src: 'generatePairToken',
        // Получаем Share-code от сервера
        onDone: { actions: 'assignCode' }
      },
      on: {
        // Игрок сидит на экране и ждет. Когда Ответственный вводит код, сервер пушит сокет-событие
        PAIRING_SUCCESS: 'onboardingComplete'
      }
    },

    // ===================================
    // ВЕТКА ОТВЕТСТВЕННОГО
    // ===================================
    responsiblePairing: {
      meta: { "@statelyai.color": "orange" },
      on: {
        ENTER_PAIRING_CODE: 'validatingCode'
      }
    },
    validatingCode: {
      meta: { "@statelyai.color": "blue" },
      invoke: {
        src: 'validatePairToken',
        onDone: 'onboardingComplete', // Код подошел! Пара создана
        onError: 'responsiblePairing' // Код неверный, попробуй еще
      }
    },

    // Конец Анбординга. Возврат в Root Machine
    onboardingComplete: {
      meta: { "@statelyai.color": "green" },
      type: 'final' 
    }
  }
});

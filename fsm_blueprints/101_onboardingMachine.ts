import { setup, assign } from 'xstate';

/**
 * 101_ONBOARDING_MACHINE (V2 - With Photo Requirement)
 * 
 * Матрешка регистрации.
 * Версия 2: Добавлен обязательный шаг загрузки селфи (для системы аватарок и рамок из Магазина).
 */

export const onboardingMachine = setup({
  types: {
    context: {} as {
      lang: 'ru' | 'uz' | 'en' | null;
      role: 'player' | 'responsible' | null;
      gender: 'male' | 'female' | null;
      startingWindow: [number, number, number] | null; 
      pairingCode: string | null;
      hasProfilePhoto: boolean;
    },
    events: {} as
      | { type: 'SET_LANG'; lang: 'ru' | 'uz' | 'en' }
      | { type: 'SET_ROLE'; role: 'player' | 'responsible' }
      | { type: 'SET_GENDER'; gender: 'male' | 'female' }
      | { type: 'SURVEY_ANSWER' } 
      | { type: 'SURVEY_COMPLETE'; window: [number, number, number] }
      | { type: 'PHOTO_UPLOADED' } // <-- НОВЫЙ ИВЕНТ
      | { type: 'PAIRING_CODE_CREATED'; code: string }
      | { type: 'ENTER_PAIRING_CODE'; code: string }
      | { type: 'PAIRING_SUCCESS' } 
  },
  actions: {
    assignLang: assign({ lang: ({ event }) => event.type === 'SET_LANG' ? event.lang : null }),
    assignRole: assign({ role: ({ event }) => event.type === 'SET_ROLE' ? event.role : null }),
    assignGender: assign({ gender: ({ event }) => event.type === 'SET_GENDER' ? event.gender : null }),
    assignWindow: assign({ startingWindow: ({ event }) => event.type === 'SURVEY_COMPLETE' ? event.window : null }),
    setPhotoUploaded: assign({ hasProfilePhoto: true }), // <-- НОВЫЙ ЭКШЕН
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
    pairingCode: null,
    hasProfilePhoto: false
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
        SURVEY_ANSWER: 'playerSurvey', 
        SURVEY_COMPLETE: { target: 'playerProfilePhoto', actions: 'assignWindow' } // <-- Изменено: идем на фото
      }
    },
    
    // Новое состояние: Требуем селфи для рамок
    playerProfilePhoto: {
      meta: { "@statelyai.color": "blue" },
      on: {
        PHOTO_UPLOADED: { target: 'playerPairing', actions: 'setPhotoUploaded' }
      }
    },

    playerPairing: {
      meta: { "@statelyai.color": "orange" },
      invoke: {
        // @ts-ignore
        src: 'generatePairToken',
        onDone: { actions: 'assignCode' }
      },
      on: {
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
        // @ts-ignore
        src: 'validatePairToken',
        onDone: 'onboardingComplete', 
        onError: 'responsiblePairing' 
      }
    },

    onboardingComplete: {
      meta: { "@statelyai.color": "green" },
      type: 'final' 
    }
  }
});

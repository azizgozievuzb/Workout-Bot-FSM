import { setup, assign } from 'xstate';

/**
 * 101_ONBOARDING_MACHINE (V3 — Extended player onboarding)
 *
 * Матрешка регистрации + перепрохождение по триггеру /settings.
 *
 * После SET_GENDER игрок проходит цепочку:
 *   player_fitness_setup → player_age_setup → player_goal_setup → done
 * где каждый шаг сохраняет выбор в users (fitness_level / age_range / goal)
 * и ставит `goal_last_updated_at = NOW()`, `goal_update_required = FALSE`.
 *
 * Повторный онбординг (/settings) перезапускает FSM с player_fitness_setup,
 * gender НЕ трогается.
 */

type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';
type AgeRange = '<18' | '18-25' | '26-35' | '36-45' | '46-55' | '55+';
type Goal = 'lose_weight' | 'build_muscle' | 'endurance' | 'health' | 'flexibility';

export const onboardingMachine = setup({
  types: {
    context: {} as {
      lang: 'ru' | 'uz' | 'en' | null;
      role: 'player' | 'responsible' | null;
      gender: 'male' | 'female' | null;
      fitnessLevel: FitnessLevel | null;
      ageRange: AgeRange | null;
      goal: Goal | null;
      startingWindow: [number, number, number] | null;
      pairingCode: string | null;
      hasProfilePhoto: boolean;
      isResettingGoal: boolean; // true для /settings, skip gender step
    },
    events: {} as
      | { type: 'SET_LANG'; lang: 'ru' | 'uz' | 'en' }
      | { type: 'SET_ROLE'; role: 'player' | 'responsible' }
      | { type: 'SET_GENDER'; gender: 'male' | 'female' }
      | { type: 'SET_FITNESS'; level: FitnessLevel }
      | { type: 'SET_AGE'; range: AgeRange }
      | { type: 'SET_GOAL'; goal: Goal }
      | { type: 'SURVEY_ANSWER' }
      | { type: 'SURVEY_COMPLETE'; window: [number, number, number] }
      | { type: 'PHOTO_UPLOADED' }
      | { type: 'PAIRING_CODE_CREATED'; code: string }
      | { type: 'ENTER_PAIRING_CODE'; code: string }
      | { type: 'PAIRING_SUCCESS' }
      | { type: 'RESET_GOAL_ONLY' } // триггер /settings
  },
  actions: {
    assignLang: assign({ lang: ({ event }) => event.type === 'SET_LANG' ? event.lang : null }),
    assignRole: assign({ role: ({ event }) => event.type === 'SET_ROLE' ? event.role : null }),
    assignGender: assign({ gender: ({ event }) => event.type === 'SET_GENDER' ? event.gender : null }),
    assignFitness: assign({ fitnessLevel: ({ event }) => event.type === 'SET_FITNESS' ? event.level : null }),
    assignAge: assign({ ageRange: ({ event }) => event.type === 'SET_AGE' ? event.range : null }),
    assignGoal: assign({ goal: ({ event }) => event.type === 'SET_GOAL' ? event.goal : null }),
    assignWindow: assign({ startingWindow: ({ event }) => event.type === 'SURVEY_COMPLETE' ? event.window : null }),
    setPhotoUploaded: assign({ hasProfilePhoto: true }),
    assignCode: assign({ pairingCode: ({ event }) => event.type === 'PAIRING_CODE_CREATED' ? event.code : null }),
    markResetting: assign({ isResettingGoal: true }),
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
    fitnessLevel: null,
    ageRange: null,
    goal: null,
    startingWindow: null,
    pairingCode: null,
    hasProfilePhoto: false,
    isResettingGoal: false,
  },
  on: {
    // Глобальный триггер /settings — перезапуск с шага fitness (gender остаётся).
    RESET_GOAL_ONLY: {
      target: '.player_fitness_setup',
      actions: 'markResetting',
    }
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
        { target: 'player_fitness_setup', guard: 'isPlayer' },
        { target: 'responsiblePairing', guard: 'isResponsible' }
      ]
    },

    // ===================================
    // ВЕТКА ИГРОКА — расширенный онбординг
    // ===================================
    player_fitness_setup: {
      meta: { "@statelyai.color": "yellow" },
      on: {
        SET_FITNESS: { target: 'player_age_setup', actions: 'assignFitness' }
      }
    },
    player_age_setup: {
      meta: { "@statelyai.color": "yellow" },
      on: {
        SET_AGE: { target: 'player_goal_setup', actions: 'assignAge' }
      }
    },
    player_goal_setup: {
      meta: { "@statelyai.color": "yellow" },
      on: {
        SET_GOAL: { target: 'playerSurvey', actions: 'assignGoal' }
      }
    },

    playerSurvey: {
      meta: { "@statelyai.color": "yellow" },
      on: {
        SURVEY_ANSWER: 'playerSurvey',
        SURVEY_COMPLETE: { target: 'playerProfilePhoto', actions: 'assignWindow' }
      }
    },

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

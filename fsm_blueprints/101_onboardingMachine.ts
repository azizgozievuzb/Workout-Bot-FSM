import { setup, assign } from 'xstate';

/**
 * 101_ONBOARDING_MACHINE (V4 — task 7.5 «Всё через Stars»)
 *
 * Онбординг целиком внутри Mini App. Бот — только точка входа (/start, приём инвайтов).
 * Промокоды и опросы в чате бота удалены.
 *
 * Два входа:
 *  - Новый (неприглашённый) юзер → пейволл (витрина тарифов) → оплата интро-месяца
 *    (paymentMachine) → становится Ответственным → короткая настройка (имя/пол) → done.
 *    Игроком самому стать нельзя — только по приглашению.
 *  - Приглашённый (вошёл по инвайту) → сразу опрос игрока (пол → fitness → age → goal),
 *    сохранение через POST /onboarding/complete → done.
 */

type Gender = 'male' | 'female';
type Fitness = 'beginner' | 'intermediate' | 'advanced';
type AgeRange = '<18' | '18-25' | '26-35' | '36-45' | '46-55' | '55+';
type Goal = 'lose_weight' | 'build_muscle' | 'endurance' | 'health' | 'flexibility';
type Tier = 'standard' | 'premium' | 'elite';

export const onboardingMachine = setup({
  types: {
    context: {} as {
      invited: boolean;
      chosenTier: Tier | null;
      gender: Gender | null;
      fitnessLevel: Fitness | null;
      ageRange: AgeRange | null;
      goal: Goal | null;
    },
    events: {} as
      | { type: 'INVITED' }               // вход по инвайту → ветка игрока
      | { type: 'NOT_INVITED' }           // обычный вход → пейволл
      | { type: 'CHOOSE_TIER'; tier: Tier }
      | { type: 'PAYMENT_SUCCESS' }       // paymentMachine → success (стал Ответственным)
      | { type: 'PAYMENT_ABORTED' }
      | { type: 'SET_NAME' }              // настройка Ответственного
      | { type: 'SET_GENDER'; gender: Gender }
      | { type: 'SET_FITNESS'; level: Fitness }
      | { type: 'SET_AGE'; range: AgeRange }
      | { type: 'SET_GOAL'; goal: Goal }  // → POST /onboarding/complete
  },
  actions: {
    markInvited: assign({ invited: true }),
    assignTier: assign({ chosenTier: ({ event }) => event.type === 'CHOOSE_TIER' ? event.tier : null }),
    assignGender: assign({ gender: ({ event }) => event.type === 'SET_GENDER' ? event.gender : null }),
    assignFitness: assign({ fitnessLevel: ({ event }) => event.type === 'SET_FITNESS' ? event.level : null }),
    assignAge: assign({ ageRange: ({ event }) => event.type === 'SET_AGE' ? event.range : null }),
    assignGoal: assign({ goal: ({ event }) => event.type === 'SET_GOAL' ? event.goal : null }),
  }
}).createMachine({
  id: 'onboardingMachine',
  initial: 'entry',
  context: {
    invited: false,
    chosenTier: null,
    gender: null,
    fitnessLevel: null,
    ageRange: null,
    goal: null,
  },
  states: {
    // Роутинг по способу входа.
    entry: {
      on: {
        INVITED: { target: 'playerSurvey', actions: 'markInvited' },
        NOT_INVITED: 'paywall'
      }
    },

    // ====================== ВЕТКА НОВОГО ЮЗЕРА (Ответственный) ======================
    // Витрина тарифов; выбор → оплата интро-месяца.
    paywall: {
      on: {
        CHOOSE_TIER: { target: 'payment', actions: 'assignTier' }
      }
    },
    // Разворачивается в paymentMachine (intro, без купона).
    payment: {
      on: {
        PAYMENT_SUCCESS: 'responsibleSetup',
        PAYMENT_ABORTED: 'paywall'
      }
    },
    // После оплаты — короткая настройка Ответственного (имя/пол).
    responsibleSetup: {
      initial: 'name',
      states: {
        name: { on: { SET_NAME: 'gender' } },
        gender: { on: { SET_GENDER: { target: 'done', actions: 'assignGender' } } },
        done: { type: 'final' }
      },
      onDone: '#onboardingMachine.complete'
    },

    // ====================== ВЕТКА ПРИГЛАШЁННОГО ИГРОКА ======================
    // Опрос внутри Mini App: пол → fitness → age → goal → POST /onboarding/complete.
    playerSurvey: {
      initial: 'gender',
      states: {
        gender: { on: { SET_GENDER: { target: 'fitness', actions: 'assignGender' } } },
        fitness: { on: { SET_FITNESS: { target: 'age', actions: 'assignFitness' } } },
        age: { on: { SET_AGE: { target: 'goal', actions: 'assignAge' } } },
        goal: { on: { SET_GOAL: { target: 'done', actions: 'assignGoal' } } },
        done: { type: 'final' }
      },
      onDone: '#onboardingMachine.complete'
    },

    complete: {
      type: 'final'
    }
  }
});

import { setup, assign } from 'xstate';

/**
 * ROOT MACHINE v4 (Coloured & Structural Clean Edition)
 * 
 * Мы совместили твою ручную расстановку блоков с глубокой логикой.
 * Для каждого состояния добавлены цвета StatelyAI.
 */

export const rootMachine = setup({
  types: {
    context: {} as {
      lang: 'ru' | 'uz' | 'en' | null;
      userRole: 'player' | 'responsible' | 'admin' | null;
      targetGender: 'male' | 'female' | null;
      userId: string | null;
      hasActiveSub: boolean;
    },
    events: {} as
      | { type: 'SET_LANG'; lang: 'ru' | 'uz' | 'en' }
      | { type: 'SET_ROLE'; role: 'player' | 'responsible' | 'admin' }
      | { type: 'SET_GENDER'; gender: 'male' | 'female' }
      | { type: 'START_APP'; userId: string }
      | { type: 'PAYMENT_OK' }
      | { type: 'RETRY' }
  },
  actions: {
    saveUserID: assign({ userId: ({ event }) => event.type === 'START_APP' ? event.userId : null }),
    assignLang: assign({ lang: ({ event }) => event.type === 'SET_LANG' ? event.lang : null }),
    assignRole: assign({ userRole: ({ event }) => event.type === 'SET_ROLE' ? event.role : null }),
    assignGender: assign({ targetGender: ({ event }) => event.type === 'SET_GENDER' ? event.gender : null }),
  },
  guards: {
    userExists: ({ event }) => event.type === 'done.invoke.fetchProfile' && event.output !== null,
    isNewUser: ({ event }) => event.type === 'done.invoke.fetchProfile' && event.output === null,
    isAdmin: ({ context }) => context.userRole === 'admin',
    needsPayment: ({ context }) => context.userRole === 'responsible' && !context.hasActiveSub,
    needsToWait: ({ context }) => context.userRole === 'player' && !context.hasActiveSub
  }
}).createMachine({
  context: {
    lang: null,
    userId: null,
    userRole: null,
    hasActiveSub: false,
    targetGender: null,
  },
  "https://github.com/azizgozievuzb/Workout-Bot-FSM/blob/91f8ef6271c66478b9b06dc04c80bfc5de57b9e2/fsm_blueprints/000_rootMachine.ts",
  id: "rootMachine",
  initial: "idle",
  states: {
    idle: {
      on: {
        START_APP: { target: "checkingProfile", actions: "saveUserID" },
      },
    },
    checkingProfile: {
      invoke: {
        src: "fetchProfile",
        onDone: [
          { target: "routing", guard: "userExists" },
          { target: "languageSelection", guard: "isNewUser" },
        ],
        onError: "error",
      },
    },
    languageSelection: {
      meta: { "@statelyai.color": "blue" },
      on: { SET_LANG: { target: "roleSelection", actions: "assignLang" } },
    },
    roleSelection: {
      meta: { "@statelyai.color": "green" },
      on: { SET_ROLE: { target: "genderSelection", actions: "assignRole" } },
    },
    genderSelection: {
      meta: { "@statelyai.color": "yellow" },
      on: { SET_GENDER: { target: "routing", actions: "assignGender" } },
    },
    routing: {
      always: [
        { target: "adminFlow", guard: "isAdmin", meta: { "@statelyai.color": "purple" } },
        { target: "paymentFlow", guard: "needsPayment", meta: { "@statelyai.color": "orange" } },
        { target: "blockedScreen", guard: "needsToWait", meta: { "@statelyai.color": "red" } },
        { target: "mainAppFlow", meta: { "@statelyai.color": "green" } },
      ],
    },
    adminFlow: { type: "final", meta: { "@statelyai.color": "purple" } },
    paymentFlow: {
      meta: { "@statelyai.color": "orange" },
      on: { PAYMENT_OK: { target: "mainAppFlow", actions: assign({ hasActiveSub: true }) } },
    },
    blockedScreen: {
      meta: { "@statelyai.color": "red" },
      on: { PAYMENT_OK: "mainAppFlow" },
    },
    mainAppFlow: { type: "final", meta: { "@statelyai.color": "green" } },
    error: {
      meta: { "@statelyai.color": "red" },
      on: { RETRY: "checkingProfile" },
    },
  },
});

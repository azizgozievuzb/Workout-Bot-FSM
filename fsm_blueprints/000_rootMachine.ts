import { setup, assign } from 'xstate';

/**
 * 000_ROOT_MACHINE
 * Главный роутер приложения.
 * Избавлен от логики анбординга: делегирует это в 101_onboardingMachine.
 * Его задача — просто направить юзера в нужное место с правильными ключами.
 */

export const rootMachine = setup({
  types: {
    context: {} as {
      userRole: 'player' | 'responsible' | 'admin' | null;
      userId: string | null;
      hasActiveSub: boolean;
      hasPartner: boolean; 
    },
    events: {} as
      | { type: 'START_APP'; userId: string }
      | { type: 'PAYMENT_OK' }
      | { type: 'RETRY' }
  },
  actions: {
    saveUserID: assign({ userId: ({ event }) => event.type === 'START_APP' ? event.userId : null })
  },
  guards: {
    // В базу стучимся: если профиль есть И пара привязана -> всё ок.
    userFullySetup: ({ event }) => event.type === 'done.invoke.fetchProfile' && event.output !== null && event.output.hasPartner === true,
    
    // Если профиля нет или пара не привязана -> отправляем проходить допросник
    isNewUser: ({ event }) => event.type === 'done.invoke.fetchProfile' && (event.output === null || event.output.hasPartner === false),
    
    isAdmin: ({ context }) => context.userRole === 'admin',
    needsPayment: ({ context }) => context.userRole === 'responsible' && !context.hasActiveSub,
    needsToWait: ({ context }) => context.userRole === 'player' && !context.hasActiveSub
  }
}).createMachine({
  context: {
    userId: null,
    userRole: null,
    hasActiveSub: false,
    hasPartner: false
  },
  meta: {
    gitHubUrl: "https://github.com/azizgozievuzb/Workout-Bot-FSM/blob/main/fsm_blueprints/000_rootMachine.ts",
  },
  id: "rootMachine",
  initial: "idle",
  states: {
    idle: {
      on: { START_APP: { target: "checkingProfile", actions: "saveUserID" } },
    },
    checkingProfile: {
      invoke: {
        src: "fetchProfile",
        onDone: [
          // Если юзер полностью готов: берем данные и роутим
          { target: "routing", guard: "userFullySetup", actions: assign({
              userRole: ({ event }) => event.output.userRole,
              hasActiveSub: ({ event }) => event.output.hasActiveSub,
              hasPartner: ({ event }) => event.output.hasPartner
          })},
          // Иначе шлем в раздевалку анбординга
          { target: "onboardingFlow", guard: "isNewUser" },
        ],
        onError: "error",
      },
    },
    // Вложенная машина Анбординга (Матрешка)
    onboardingFlow: {
      meta: { "@statelyai.color": "blue" },
      invoke: {
        src: "onboardingMachine",
        onDone: "checkingProfile" // После успешного Анбординга повторно проверяем профиль
      }
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
      // Ответственный оплатил: пускаем в главное меню
      on: { PAYMENT_OK: { target: "mainAppFlow", actions: assign({ hasActiveSub: true }) } },
    },
    blockedScreen: {
      meta: { "@statelyai.color": "red" },
      // Игрок ждет. Как только Ответственный оплатил, Игрок переходит в главное меню
      on: { PAYMENT_OK: "mainAppFlow" }, 
    },
    mainAppFlow: { type: "final", meta: { "@statelyai.color": "green" } },
    error: {
      meta: { "@statelyai.color": "red" },
      on: { RETRY: "checkingProfile" },
    },
  },
});

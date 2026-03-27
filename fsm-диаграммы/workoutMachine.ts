import { createMachine } from 'xstate';

export const workoutMachine = createMachine({
  id: 'WorkoutBotFlow',
  initial: 'idle',
  states: {
    idle: {
      on: {
        START: 'workoutMenu'
      }
    },
    workoutMenu: {}
  }
});

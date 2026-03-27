import { createMachine } from 'xstate';

export const workoutMachine = createMachine({
  id: 'WorkoutMachine',
  initial: 'idle',
  states: {
    idle: {
      on: {
        START_WORKOUT: [
          {
            target: 'workoutBlocked',
            guard: 'hasDoneWorkoutToday'
          },
          {
            target: 'choosingDifficulty'
          }
        ]
      }
    },
    workoutBlocked: {
      description: 'Отправляем интересный ИИ-факт про фитнес/ПП и блокируем повторный старт',
      on: {
        BACK_TO_MENU: 'idle'
      }
    },
    choosingDifficulty: {
      on: {
        SELECT_EASY: 'showingExercise',
        SELECT_MEDIUM: 'showingExercise',
        SELECT_HARD: 'showingExercise'
      }
    },
    showingExercise: {
      description: 'Отправка текста и GIF с сегодняшним упражнением',
      on: {
        READY_TO_PROVE: 'waitingForVideo'
      }
    },
    waitingForVideo: {
      description: 'Асинхронное ожидание. Бот ждет кружок или видео в Telegram',
      on: {
        VIDEO_RECEIVED: 'aiEvaluation'
      }
    },
    aiEvaluation: {
      description: 'Google Gemini анализирует старания с видео',
      on: {
        EFFORT_ABOVE_50: 'successReward',
        EFFORT_BELOW_50: 'softReward'
      }
    },
    successReward: {
      description: 'Начисляем базовые звезды + Бонус + Стрик. Выдаем комплимент.',
      type: 'final'
    },
    softReward: {
      description: 'Без штрафов. Начисляем только базу и подбадриваем.',
      type: 'final'
    }
  }
});

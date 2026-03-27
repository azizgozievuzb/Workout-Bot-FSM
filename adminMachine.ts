import { createMachine, assign } from 'xstate';

/**
 * AdminControlMachine: Интерфейс для вас.
 * Управление видео-библиотекой и сценариями тренировок.
 */
export const adminMachine = createMachine({
  id: 'AdminPanel',
  initial: 'idle',
  context: {
    selectedLevel: 1, // 1, 2 или 3
    videoSlots: {
      cardio: [null, null], // 2 постоянных кардио
      variable: [null, null, null, null, null, null] // 6 сменных слотов
    }
  },
  states: {
    idle: {
      on: {
        VIEW_LEVEL: { target: 'editLevelMode', actions: assign({ selectedLevel: ({ event }: any) => event.level }) }
      }
    },

    // 1. РЕЖИМ РЕДАКТИРОВАНИЯ УРОВНЯ
    editLevelMode: {
      on: {
        // Загрузка нового видео в конкретный слот
        UPLOAD_TO_SLOT: { target: 'uploadingVideo' },
        
        // Массовое обновление (перемешать)
        SHUFFLE_EXERCISES: { target: 'idle', actions: 'shuffleVariableSlots' },
        
        SAVE_CHANGES: 'savingToDB',
        BACK: 'idle'
      }
    },

    // 2. ПРОЦЕСС ЗАГРУЗКИ В ОБЛАКО (Supabase/S3)
    uploadingVideo: {
      invoke: {
        src: 'uploadToStorage',
        onDone: { target: 'editLevelMode', actions: 'updateContextSlot' },
        onError: 'editLevelMode'
      }
    },

    // 3. СОХРАНЕНИЕ В ГЛОБАЛЬНУЮ БАЗУ (Обновление сценария для Mini App)
    savingToDB: {
      invoke: {
        src: 'saveToSupabase',
        onDone: 'idle',
        onError: 'editLevelMode'
      }
    }
  }
});

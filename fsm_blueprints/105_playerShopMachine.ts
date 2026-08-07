import { setup, assign } from 'xstate';

/**
 * 105_PLAYER_SHOP_MACHINE
 *
 * Витрина Игрока (куб Market, режим Player) после 8c + 8d + 8d.1.
 *
 * ⚠️ Машина переписана в 8d.1: прежняя версия описывала «Тренировочное Золото»,
 * лутбоксы, скипы и троллинг Ответственного — ничего этого в проекте нет.
 * Легаси-таблицы `shop_items`/`purchases` снесены в 8d.
 *
 * Реальная витрина (капли 💧, app_shop_items):
 *   1. Открыть / закрыть light-режим (через дисклеймер-тест);
 *   2. Заморозка (кап купленных 3);
 *   3. Фото-карточка — подмашина cardPhoto;
 *   4. 🎁 Полка наставника — лоты пары (8d);
 *   5. 🧾 Мои покупки — обещания в работе и история.
 *
 * 8d.1:
 *   • П.7 — секция полки видна ВСЕГДА при живом партнёрстве; пустые слоты
 *     рисуются пунктирными заглушками (было: секция исчезала, находка №23).
 *   • П.8a — карточка фото «хамелеон»: миниатюра + «установлено» + «Сменить».
 *   • П.8b — у Stars-предмета свой текст-эффект, а не статус обещания.
 *   • П.8c/Д6 — одна крупная кнопка текущего шага; отчёт можно приложить и
 *     ПОСЛЕ галочки (отдельный эндпоинт, репутацию повторно не растит).
 *   • П.6a — видео смотрится во встроенном плеере, а не во внешней вкладке.
 *   • П.10 — экран выбора фото: оригинал + слабая и глубокая обработка.
 *
 * Эконом-патч №1 (S62):
 *   • П.7 — состояние `confirmingSpend` перед КАЖДОЙ необратимой тратой капель
 *     (лот полки, витрина, реролл/смена фото, смена графика, restore стрика).
 *     Обхода нет: «не спрашивать» не существует ни в каком виде. Исключение —
 *     unlock/lock light: там уже стоит дисклеймер-тест (8.10).
 *   • Э.1 — на полке больше НЕТ витринных позиций (freeze/photo_reroll):
 *     каталог полки — чистый эксклюзив, дублей с витриной не бывает.
 *   • Э.4 — витрина рисуется сеткой ячеек-слотов; это визуальный язык,
 *     механики ротации за ним нет.
 *   • Лот `schedule_cooldown_reset` без активного кулдауна не выкупается:
 *     гейт в RPC ДО списания, в UI — серая кнопка + тост (П.9).
 *
 * Реализация: frontend/src/components/cubes/{MarketCube,CardPhotoFlow}.tsx,
 * frontend/src/components/shared/ConfirmSpendModal.tsx;
 * бэкенд backend/api/routers/player_shop.py.
 */

export const playerShopMachine = setup({
  types: {
    context: {} as {
      playerId: string;
      dropsBalance: number;
      /** Есть живая пара — полка показывается даже пустой (П.7). */
      hasMentor: boolean;
      /** Слотов на полке по тарифу наставника: столько ячеек и рисуем. */
      shelfSlotsTotal: number;
      selectedItemId: string | null;
      selectedItemPrice: number | null;
      /** Что подтверждаем в окне траты (П.7): лот полки или витринная покупка. */
      spendKind: 'lot' | 'freeze' | null;
      /** Подаренные наставником рероллы — тратятся вне прогрессии цен (8d). */
      rerollCredits: number;
    },
    events: {} as
      | { type: 'SHOP_LOADED'; shop: any }
      | { type: 'BUY_LOT'; itemId: string; price: number }
      | { type: 'HIDE_LOT'; itemId: string }          // «Неинтересно»
      | { type: 'MARK_DONE'; itemId: string }         // ✓ Отметить выполненным
      | { type: 'ATTACH_REPORT'; itemId: string }     // 🎥 Приложить отчёт (Д6)
      | { type: 'VIDEO_READY'; blob: Blob }
      | { type: 'PLAY_VIDEO'; itemId: string; kind: 'promise' | 'report' }
      | { type: 'DOWNLOAD_VIDEO'; itemId: string; kind: 'promise' | 'report' }
      | { type: 'BUY_FREEZE' }
      | { type: 'TOGGLE_LIGHT'; direction: 'unlock' | 'lock' }
      | { type: 'DISCLAIMER_PASSED' }
      | { type: 'OPEN_CARD_FLOW' }
      | { type: 'PURCHASE_MODE'; mode: 'ai' | 'raw' }
      | { type: 'PHOTO_TAKEN'; base64: string }
      | { type: 'VARIANTS_READY' }
      | { type: 'CHOOSE_VARIANT'; index: number }     // -1 = «оставить как есть» (Д7)
      | { type: 'REROLL' }
      | { type: 'CONFIRM_SPEND' }                     // «Купить» в окне подтверждения (П.7)
      | { type: 'CANCEL' }
      | { type: 'DONE' }
      | { type: 'BACK_TO_GATE' }
  },
  actions: {
    applyShop: assign({
      dropsBalance: ({ event }) => (event as any).shop.drops_balance,
      hasMentor: ({ event }) => (event as any).shop.has_mentor,
      shelfSlotsTotal: ({ event }) => (event as any).shop.shelf_slots_total,
      rerollCredits: ({ event }) => (event as any).shop.reroll_credits
    }),
    selectItem: assign({
      selectedItemId: ({ event }) => (event as any).itemId ?? null,
      selectedItemPrice: ({ event }) => (event as any).price ?? null,
      spendKind: ({ event }) => (event.type === 'BUY_FREEZE' ? 'freeze' : 'lot')
    }),
    clearSelection: assign({
      selectedItemId: null, selectedItemPrice: null, spendKind: null
    })
  },
  guards: {
    // Дублируется на сервере в RPC buy_shelf_item — UI лишь бережёт от лишнего
    // запроса, решает всё равно транзакция (кап заморозок проверяется ДО списания).
    hasEnoughDrops: ({ context }) =>
      context.selectedItemPrice !== null && context.dropsBalance >= context.selectedItemPrice,
    isLotSpend: ({ context }) => context.spendKind === 'lot'
  }
}).createMachine({
  id: 'playerShopMachine',
  initial: 'loadingShop',
  context: {
    playerId: 'user_1',
    dropsBalance: 0,
    hasMentor: false,
    shelfSlotsTotal: 0,
    selectedItemId: null,
    selectedItemPrice: null,
    spendKind: null,
    rerollCredits: 0
  },
  states: {
    loadingShop: {
      meta: { '@statelyai.color': 'gray' },
      invoke: {
        // @ts-ignore
        src: 'getPlayerShop'              // GET /players/me/shop — агрегат витрины
      },
      on: { SHOP_LOADED: { target: 'browsingShop', actions: 'applyShop' } }
    },

    // =====================================================================
    // Главный экран витрины: карточки + полка наставника + мои покупки.
    // =====================================================================
    browsingShop: {
      meta: { '@statelyai.color': 'blue' },
      on: {
        // П.7: тап по «Купить» НИКОГДА не списывает сразу — сначала окно с
        // ценой и остатком. Нехватку капель показываем в том же окне.
        BUY_LOT: { target: 'confirmingSpend', actions: 'selectItem' },
        BUY_FREEZE: { target: 'confirmingSpend', actions: 'selectItem' },
        HIDE_LOT: 'hidingLot',
        MARK_DONE: 'fulfilling',
        ATTACH_REPORT: 'recordingReport',
        PLAY_VIDEO: 'videoPlayer',
        DOWNLOAD_VIDEO: 'browsingShop',   // Д5: сохранение файла внешним механизмом
        TOGGLE_LIGHT: 'disclaimerTest',   // у light свой гейт — дисклеймер-тест (8.10)
        OPEN_CARD_FLOW: 'cardPhoto',
        BACK_TO_GATE: 'exitShop'
      }
    },

    // Единое окно подтверждения необратимой траты (П.7): название, цена,
    // остаток после списания, «Отменить» / «Купить». Кнопка подтверждения
    // неактивна, если капель не хватает, — отдельного экрана отказа больше нет.
    confirmingSpend: {
      meta: { '@statelyai.color': 'orange' },
      on: {
        CONFIRM_SPEND: [
          { target: 'buyingLot', guard: 'isLotSpend' },
          { target: 'buyingFreeze', guard: 'hasEnoughDrops' },
          { target: 'insufficientFunds' }
        ],
        CANCEL: { target: 'browsingShop', actions: 'clearSelection' }
      }
    },

    insufficientFunds: {
      meta: { '@statelyai.color': 'red' },
      on: { CANCEL: { target: 'browsingShop', actions: 'clearSelection' } }
    },

    // =====================================================================
    // Полка наставника (8d)
    // =====================================================================
    buyingLot: {
      meta: { '@statelyai.color': 'yellow' },
      invoke: {
        // @ts-ignore
        src: 'buyShelfItem',              // POST /players/me/shelf/{id}/buy → RPC
        // Обещание → 'purchased' (наставнику «⏳»); Stars-предмет → сразу
        // 'fulfilled', эффект выдан в той же транзакции:
        //   light_trial             → неделя light со следующего пн (одноразово);
        //   schedule_cooldown_reset → кулдаун смены графика снят;
        //   title                   → звание из meta лота встаёт игроку.
        // Гейты эффекта проверяются ДО списания — капли не сгорают впустую.
        onDone: { target: 'loadingShop', actions: 'clearSelection' },
        onError: { target: 'browsingShop', actions: 'clearSelection' }
      }
    },
    hidingLot: {
      meta: { '@statelyai.color': 'yellow' },
      invoke: {
        // @ts-ignore
        src: 'hideShelfItem',             // слот остаётся занятым, наставник уведомлён
        onDone: 'loadingShop',
        onError: 'browsingShop'
      }
    },

    // =====================================================================
    // Мои покупки (П.8c): галочку ставит ИГРОК; видеоотчёт — опционально
    // вместе с ней ИЛИ отдельным шагом позже (Д6).
    // =====================================================================
    fulfilling: {
      meta: { '@statelyai.color': 'yellow' },
      invoke: {
        // @ts-ignore
        src: 'fulfillShelfItem',          // POST /players/me/shelf/{id}/fulfill
        onDone: 'loadingShop',            // репутация наставника растёт ЗДЕСЬ и один раз
        onError: 'browsingShop'
      }
    },
    recordingReport: {
      meta: { '@statelyai.color': 'orange' },
      // Тот же рекордер и тот же пресет «C», что у обещания наставника (15 с).
      on: {
        VIDEO_READY: 'attachingReport',
        CANCEL: 'browsingShop'
      }
    },
    attachingReport: {
      meta: { '@statelyai.color': 'yellow' },
      invoke: {
        // @ts-ignore
        src: 'attachShelfReport',         // POST /players/me/shelf/{id}/report (Д6)
        // Гейты: член пары-владелец, статус 'fulfilled', отчёта ещё нет.
        // Репутацию повторно НЕ растит — статус лота не меняется.
        onDone: 'loadingShop',
        onError: 'recordingReport'
      }
    },

    videoPlayer: {
      meta: { '@statelyai.color': 'blue' },
      // П.6a: окно поверх витрины, подписанная ссылка грузится лениво.
      on: { CANCEL: 'browsingShop', DONE: 'browsingShop' }
    },

    // =====================================================================
    // Витринные покупки за капли
    // =====================================================================
    buyingFreeze: {
      meta: { '@statelyai.color': 'yellow' },
      invoke: {
        // @ts-ignore
        src: 'buyFreeze',                 // RPC buy_paid_freeze, кап 3 проверяется в транзакции
        onDone: 'loadingShop',
        onError: 'browsingShop'
      }
    },
    disclaimerTest: {
      meta: { '@statelyai.color': 'orange' },
      // Light открывается/закрывается только после теста на понимание правил.
      on: {
        DISCLAIMER_PASSED: 'togglingLight',
        CANCEL: 'browsingShop'
      }
    },
    togglingLight: {
      meta: { '@statelyai.color': 'yellow' },
      invoke: {
        // @ts-ignore
        src: 'unlockOrLockLight',         // активация со следующего понедельника
        onDone: 'loadingShop',
        onError: 'browsingShop'
      }
    },

    // =====================================================================
    // Фото-карточка (8.8b + 8c.1 + 8d.1 П.10)
    // =====================================================================
    cardPhoto: {
      meta: { '@statelyai.color': 'purple' },
      initial: 'choosingMode',
      states: {
        // Режим выбирается ДО оплаты: raw — фикс-цена, ai — прогрессия.
        choosingMode: {
          // П.7: цена в окне — уже посчитанная прогрессия (бэк отдаёт её
          // готовой), а не базовая из прайса.
          on: { PURCHASE_MODE: 'confirmingPurchase' }
        },
        confirmingPurchase: {
          on: { CONFIRM_SPEND: 'purchasing', CANCEL: 'choosingMode' }
        },
        purchasing: {
          invoke: {
            // @ts-ignore
            src: 'cardPhotoPurchase',     // RPC begin_card_purchase (двойной клик не спишет дважды)
            onDone: 'awaitingPhoto',
            onError: 'choosingMode'
          }
        },
        awaitingPhoto: {
          // Источник селфи: живая камера getUserMedia / input capture / галерея.
          // Кадр отклоняется, если videoWidth === 0 — иначе в AI уезжал чёрный
          // кадр (хотфикс смоука 8d).
          on: { PHOTO_TAKEN: 'uploading' }
        },
        uploading: {
          invoke: {
            // @ts-ignore
            src: 'cardPhotoUpload',
            // mode='raw' → фото сразу становится карточкой, в AI не уходит.
            onDone: 'processing',
            onError: 'awaitingPhoto'
          }
        },
        processing: {
          // Одна попытка = ДВЕ генерации: 'weak' (максимум сходства) и 'deep'
          // (сильная стилизация). COGS не вырос — раньше это были два случайных
          // прогона одного промпта, отсюда и «сходство скачет» (находка №27).
          on: { VARIANTS_READY: 'choosingVariant' }
        },
        choosingVariant: {
          // На экране три карточки: ОРИГИНАЛ + слабая + глубокая обработка.
          on: {
            CHOOSE_VARIANT: 'applyingChoice',   // index -1 = «оставить как есть» (Д7)
            // П.7: реролл тоже проходит окно подтверждения — в нём стоит
            // АКТУАЛЬНАЯ прогрессивная цена (или «потратится подарок»).
            REROLL: 'confirmingReroll'
          }
        },
        confirmingReroll: {
          on: { CONFIRM_SPEND: 'rerolling', CANCEL: 'choosingVariant' }
        },
        rerolling: {
          invoke: {
            // @ts-ignore
            src: 'cardPhotoReroll',
            // RPC сначала тратит подаренный reroll_credit: капли не списываются
            // и счётчик прогрессии цен не двигается.
            onDone: 'processing',
            onError: 'choosingVariant'
          }
        },
        applyingChoice: {
          invoke: {
            // @ts-ignore
            src: 'cardPhotoChoose',
            onDone: 'done',
            onError: 'choosingVariant'
          }
        },
        done: {
          // Превью «так тебя видит наставник».
          type: 'final'
        }
      },
      onDone: 'loadingShop',
      on: { CANCEL: 'loadingShop' }
    },

    exitShop: {
      meta: { '@statelyai.color': 'gray' },
      type: 'final'                       // возвращает контроль в 103_workoutGateMachine
    }
  }
});

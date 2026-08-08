import { setup, assign } from 'xstate';

/**
 * 104_RESPONSIBLE_MACHINE
 *
 * Панель Ответственного (наставника) после 8d + 8d.1.
 *
 * ⚠️ Машина переписана в 8d.1: прежняя версия описывала эпоху БУСТОВ (⚡X2 за
 * Stars + пинги), а бусты снесены целиком ещё в 8d (решение S55) — таблица
 * `boosts`, роутер, сервис и продукты Stars удалены. Оставлять их в «источнике
 * правды» было опаснее, чем переписать.
 *
 * 8d.1 (П.1a) разносит панель наставника по двум кубам — одна роль на куб:
 *   • Action  — НАБЛЮДЕНИЕ: досье игрока, дарение капель/заморозок. Полки нет.
 *   • Market  — ПОЛКА игрока: лоты, слоты, цены, видео-обещания, «⏳ ждут
 *               исполнения», пополнение пула капель.
 *   • Bond    — только связи/партнёрства, карточки игрока там нет.
 *
 * Обе страницы полноэкранные (П.2). Между ними навигационная ПАРА: с профиля —
 * строка-дверь «🎁 Полка X/N →», с полки — «👤 К профилю →». `returnTo` держит
 * точку входа, чтобы «← Назад» вернул туда, откуда пришли (в коде это стек
 * страниц в MentorPlayerScreens.tsx).
 *
 * Эконом-патч №1 (S62):
 *   • Э.3.2 — в шапке Market (режим R, рядом с пулом 💧) индикатор подписки
 *     «Тариф · осталось N дн · [Продлить]». Порог красноты решает БЭК
 *     (SUBSCRIPTION_WARN_DAYS), «Продлить» просит бота положить счёт продления
 *     в чат. Игроку этот блок не показывается НИКОГДА (инвариант §1).
 *   • Хвост 4 — «Подарить заморозку» списывает капли из пула, а не из
 *     упразднённого `gift_freeze_balance`.
 *   • Э.1/Э.2a — каталог полки: чистый эксклюзив, три лота ядра v1,
 *     цена выкупа фиксирована каталогом.
 *
 * Реализация: frontend/src/components/cubes/{ActionCube,MarketCube}.tsx →
 * MentorPlayerScreens → {MentorPlayerProfile, MentorShelfPage};
 * бэкенд backend/api/routers/shelf.py.
 */

type Entry = 'action' | 'market';

export const responsibleMachine = setup({
  types: {
    context: {} as {
      responsibleId: string;
      playerId: string | null;
      /** Из какого куба вошли — определяет, куда вернёт «← Назад». */
      returnTo: Entry;
      /** Пул капель наставника для подарков (users.gift_balance). */
      giftBalance: number;
      /** Слоты полки ЭТОГО игрока: заняты / всего (по живому тарифу: 2/4/6). */
      slotsUsed: number;
      slotsTotal: number;
      /** Купленные, но не исполненные обещания — бейдж «⏳ N» в списке Market. */
      pendingPromises: number;
    },
    events: {} as
      | { type: 'OPEN_PROFILE'; playerId: string; from: Entry }   // тап по строке в Action
      | { type: 'OPEN_SHELF'; playerId: string; from: Entry }     // тап по строке в Market
      | { type: 'GO_TO_SHELF' }                                   // дверь «🎁 Полка X/N →»
      | { type: 'GO_TO_PROFILE' }                                 // ссылка «👤 К профилю →»
      | { type: 'BACK' }
      | { type: 'PAGE_LOADED'; page: any }
      | { type: 'TOP_UP_POOL' }                                   // «Пополнить» (drop packs)
      | { type: 'GIFT_DROPS' }
      | { type: 'GIFT_FREEZE' }
      | { type: 'ADD_PROMISE' }
      | { type: 'ADD_STAR_ITEM' }
      | { type: 'VIDEO_READY'; blob: Blob }
      | { type: 'EDIT_PRICE'; itemId: string }
      | { type: 'REPUBLISH'; itemId: string }
      | { type: 'REMOVE_ITEM'; itemId: string }
      | { type: 'PLAY_VIDEO'; itemId: string; kind: 'promise' | 'report' }
      | { type: 'CLOSE' }
      | { type: 'PAYMENT_SUCCESS' }
      | { type: 'PAYMENT_CANCEL' }
  },
  actions: {
    rememberEntry: assign({
      playerId: ({ event }) => (event as any).playerId ?? null,
      returnTo: ({ event }) => (event as any).from ?? 'action'
    }),
    applyPage: assign({
      giftBalance: ({ event }) => (event as any).page.gift_balance,
      slotsUsed: ({ event }) => (event as any).page.slots_used,
      slotsTotal: ({ event }) => (event as any).page.slots_total,
      pendingPromises: ({ event }) => (event as any).page.pending_count
    })
  },
  guards: {
    // П.9: при полной полке кнопки не блокируются — тап показывает тост
    // «Все слоты заняты…». Постоянной строки-предупреждения больше нет.
    hasFreeSlot: ({ context }) => context.slotsUsed < context.slotsTotal,
    cameFromAction: ({ context }) => context.returnTo === 'action'
  }
}).createMachine({
  id: 'responsibleMachine',
  initial: 'cubeList',
  context: {
    responsibleId: 'resp_1',
    playerId: null,
    returnTo: 'action',
    giftBalance: 0,
    slotsUsed: 0,
    slotsTotal: 2,
    pendingPromises: 0
  },
  states: {
    // =====================================================================
    // Списки игроков в кубах. Action — без бейджа «⏳» (Д1: он живёт в Market).
    // 8d.1a: строка каждого куба отражает роль куба — Action рабочий баннер
    // (тап → досье), Market добавляет «🎁 X/N» (красный при полноте) рядом с
    // «⏳ N», Bond — компактная строка-список без клика (там только связь).
    // =====================================================================
    cubeList: {
      meta: { '@statelyai.color': 'blue' },
      on: {
        OPEN_PROFILE: { target: 'loadingPage.toProfile', actions: 'rememberEntry' },
        OPEN_SHELF: { target: 'loadingPage.toShelf', actions: 'rememberEntry' },
        TOP_UP_POOL: 'dropPacks'
      }
    },

    // Один запрос GET /shelf/players/{id}/page обслуживает ОБЕ страницы —
    // переход «профиль ⇄ полка» происходит без повторной загрузки.
    loadingPage: {
      meta: { '@statelyai.color': 'gray' },
      initial: 'toProfile',
      states: {
        toProfile: {
          on: { PAGE_LOADED: { target: '#responsibleMachine.playerProfile', actions: 'applyPage' } }
        },
        toShelf: {
          on: { PAGE_LOADED: { target: '#responsibleMachine.playerShelf', actions: 'applyPage' } }
        }
      },
      on: { BACK: 'cubeList' }
    },

    // =====================================================================
    // Action (R): страница НАБЛЮДЕНИЯ — полноэкранная (П.2, П.3).
    // Досье (фото + чипы столбиком), 3 плитки с расшифровками, дарение, внизу
    // дверь на полку. Управления полкой здесь НЕТ.
    // XP-прогресс-бар удалён (Д4): системы уровней в игре нет.
    // 8d.1a: чипы — цель / подготовка / график «пн·ср·пт» / подписка «N дн»
    // (краснеет при ≤3); чип «пол» убран (Д1). Третья плитка — «последняя
    // тренировка» вместо «рекорда» (Д3): исторический максимум не подсказывает
    // наставнику, что делать сегодня.
    // =====================================================================
    playerProfile: {
      meta: { '@statelyai.color': 'green' },
      on: {
        GO_TO_SHELF: 'playerShelf',       // дверь кликабельна даже при полной полке (П.9)
        GIFT_DROPS: 'giftingDrops',
        GIFT_FREEZE: 'giftingFreeze',
        TOP_UP_POOL: 'dropPacks',         // Д2: шорткат из окна дарения, чтобы пустой пул не был тупиком
        BACK: 'cubeList'
      }
    },

    giftingDrops: {
      meta: { '@statelyai.color': 'purple' },
      invoke: {
        // @ts-ignore
        src: 'giftDropsRpc',              // POST /shelf/gift-drops → RPC gift_drops
        onDone: 'playerProfile',
        onError: 'playerProfile'
      },
      on: { CLOSE: 'playerProfile' }
    },

    giftingFreeze: {
      meta: { '@statelyai.color': 'purple' },
      invoke: {
        // @ts-ignore
        src: 'giftFreeze',                // POST /shelf/gift-freeze → RPC gift_freeze
        // Эконом-патч №1 (хвост 4): списывает ВИТРИННУЮ цену заморозки из
        // gift_balance → игроку +1 в запас (кап 3). Отдельного «запаса
        // заморозок» (gift_freeze_balance) больше нет — колонка снесена в 039,
        // пополнять её было нечем. Кап игрока и пустой пул закрывают кнопку
        // серым + тост (П.9), отказ приходит ДО списания.
        onDone: 'playerProfile',
        onError: 'playerProfile'
      },
      on: { CLOSE: 'playerProfile' }
    },

    // =====================================================================
    // Market (R): ПОЛКА игрока — полноэкранная (П.1c, П.2, П.9).
    // Шапка-минимум: фото + имя + счётчик слотов + «👤 К профилю →».
    // Живых цифр наблюдения (стрик/XP) в шапке нет — они в профиле.
    // =====================================================================
    playerShelf: {
      meta: { '@statelyai.color': 'green' },
      on: {
        GO_TO_PROFILE: 'playerProfile',
        ADD_PROMISE: [
          { target: 'recordingPromise', guard: 'hasFreeSlot' },
          { target: 'slotsFullToast' }
        ],
        ADD_STAR_ITEM: [
          { target: 'starItemInvoice', guard: 'hasFreeSlot' },
          { target: 'slotsFullToast' }
        ],
        EDIT_PRICE: 'savingPrice',
        REPUBLISH: 'savingPrice',         // PATCH status='active', повторной оплаты Stars нет
        REMOVE_ITEM: 'removingItem',
        PLAY_VIDEO: 'videoPlayer',
        BACK: [
          { target: 'playerProfile', guard: 'cameFromAction' },
          { target: 'cubeList' }
        ]
      }
    },

    // П.9: тост поверх экрана, экран не меняется. Красный счётчик в шапке и
    // серые кнопки — постоянные сигналы; тост объясняет причину по тапу.
    slotsFullToast: {
      meta: { '@statelyai.color': 'red' },
      after: { 3500: 'playerShelf' },
      on: { CLOSE: 'playerShelf' }
    },

    // Рекордер живёт на полноэкранной полке (аргумент находки №17 закрыт).
    // Пресет «C» (S57): 15 с · 480×640 · видео 400 кбит/с · аудио 64 кбит/с моно · 30 fps.
    recordingPromise: {
      meta: { '@statelyai.color': 'orange' },
      on: {
        VIDEO_READY: 'uploadingPromise',
        CLOSE: 'playerShelf'
      }
    },
    uploadingPromise: {
      meta: { '@statelyai.color': 'yellow' },
      invoke: {
        // @ts-ignore
        src: 'createPromise',             // POST /shelf/promise (multipart, приватный бакет)
        onDone: 'playerShelf',
        onError: 'recordingPromise'       // причина показывается ВНУТРИ рекордера
      }
    },

    // Покупка Stars-предмета = сразу выставление на полку, инвентаря нет.
    // Эконом-патч №1: каталог = чистый эксклюзив (freeze/photo_reroll убраны,
    // Э.1). Ядро v1 в патче — light_trial / title (лот schedule_cooldown_reset
    // исключён из каталога решением S62-3.1). У `title` наставник вводит
    // свободный текст звания (лимит по вёрстке) — он едет в meta лота и при
    // выкупе встаёт игроку. `light_trial` одноразовый: недоступен, если light
    // уже открыт, трайал использован или лот уже висит на полке.
    //
    // S62-2 — ЦЕНУ ЛОТА НАЗНАЧАЕТ НАСТАВНИК («кто размещает — тот и ценит»):
    // 4 ступени-пресета (5/15/30/50% теоретического месячного потолка ЭТОГО
    // игрока) или своя цифра в коридоре [10 💧 … потолок]. Каталожная цена
    // осталась рекомендованным ориентиром — по ней подсвечена ступень.
    // Коридор фиксируется в момент размещения; смена режима игрока после
    // цену выставленных лотов не трогает. Менять цену можно ТОЛЬКО ВНИЗ
    // (RPC set_shelf_item_price) — игрок, копящий на цену, не должен увидеть
    // её выросшей. ⚠️ Инвариант §1: наставнику показывается только потолок
    // ФОРМУЛ, фактический заработок и баланс игрока — никогда.
    starItemInvoice: {
      meta: { '@statelyai.color': 'orange' },
      invoke: {
        // @ts-ignore
        src: 'createStarItemInvoice'      // POST /shelf/star-item → invoice link
      },
      on: {
        PAYMENT_SUCCESS: 'playerShelf',   // лот создаёт fulfill платежа на бэке
        PAYMENT_CANCEL: 'playerShelf',
        CLOSE: 'playerShelf'
      }
    },

    savingPrice: {
      meta: { '@statelyai.color': 'yellow' },
      invoke: {
        // @ts-ignore
        src: 'patchShelfItem',            // PATCH /shelf/items/{id} — только цена ОБЕЩАНИЙ
        onDone: 'playerShelf',
        onError: 'playerShelf'
      }
    },
    removingItem: {
      meta: { '@statelyai.color': 'yellow' },
      invoke: {
        // @ts-ignore
        src: 'deleteShelfItem',           // DELETE /shelf/items/{id} (только active/hidden)
        onDone: 'playerShelf',
        onError: 'playerShelf'
      }
    },

    // П.6a (находка №18): видео играет ВНУТРИ приложения, подписанная ссылка
    // грузится лениво по тапу. tg.openLink для просмотра больше не используется.
    videoPlayer: {
      meta: { '@statelyai.color': 'blue' },
      on: { CLOSE: 'playerShelf' }
    },

    // Пополнение пула капель за Stars (drop packs). Канонический дом — Market,
    // из окна дарения в Action открывается тем же модальным окном (Д2).
    dropPacks: {
      meta: { '@statelyai.color': 'orange' },
      on: {
        PAYMENT_SUCCESS: 'cubeList',
        PAYMENT_CANCEL: 'cubeList',
        CLOSE: 'cubeList'
      }
    }
  }
});

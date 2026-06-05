# 🔥 TASK 7.3 — E2E Smoke Test Plan (Standard Tier)

**Дата подготовки:** 2026-04-27 (Сессия 33, Cowork)
**Обновлено:** 2026-04-30 (Сессия 34) — BUG-1, BUG-2 fixed; cycle 35 → 27 min
**Модель для исполнения:** Sonnet + medium effort
**Длительность прогона:** ~40–45 мин (27 из них — workout)
**Цель:** убедиться, что main happy path (онбординг → workout → shop) работает в проде на iPhone/Android.

**Текущий конфиг цикла** (`backend/core/workout_config.py`):
- Prepare: 5s · Exercise: **60s** · Rest+AI: **30s** · Review: 5s · Total: 16 × 100s ≈ 27 мин

---

## 📊 Состояние БД на момент старта (`dlpdwmmfpzfxcelxqvlq`)

| TG ID | Username | Имя | Роль | Tier | Состояние |
|---|---|---|---|---|---|
| 32267272 | AzizGoziev | ₳ⱫłⱫ | admin + responsible | elite (0/3) | основной аккаунт пользователя |
| 7278081310 | Shekspe | Mr. | responsible | premium (2/2 — лимит) | спарен с A + Dol |
| 156453252 | GmdLt | A | player | premium | спарен с Mr., 0 workouts |
| 7458599391 | forcashe | Dol | player | premium | спарен с Mr., **goal_update_required=true, active_days=121** (legacy guard заблокирует Mini App) |

Миграция 025 (drop `users.access_tier`) применена ✅.

---

## 🎯 Сценарий: Variant 2 — полный standard-flow

Цепочка для получения **player standard** (его в проде нет, нужно создать):
1. Aziz (admin) генерит **R-код standard**
2. Свежий TG #1 → вводит R-код → становится **Responsible standard**
3. Этот Responsible standard генерит **P-код** (наследует свой tier=standard)
4. Свежий TG #2 → вводит P-код → становится **Player standard**
5. Smoke прогоняется на TG #2 (оба новых аккаунта остаются в БД — после теста можно будет почистить)

---

## 📋 Phase 0 — Setup standard-цепочки (10 мин)

### 0.1 Генерация R-кода standard
- На основном аккаунте **Aziz**: `/admin` → Промокоды → создать **R-код tier=standard**
- Записать код. Прислать новой Claude-сессии для проверки в БД.
- **БД-проверка:**
  ```sql
  SELECT code, kind, tier, is_used, max_uses, expires_at, created_at
  FROM promo_codes
  WHERE code = '<R-CODE>';
  -- Ожидание: kind='responsible', tier='standard', is_used=false
  ```

### 0.2 Регистрация Responsible standard
- Открыть **новый TG #1** (свежий аккаунт).
- `/start` → ввести R-код из 0.1 → бот должен запросить пол/имя (онбординг Responsible).
- Пройти онбординг до конца. **БД-проверка:**
  ```sql
  SELECT telegram_id, telegram_username, primary_role, has_responsible_access,
         responsible_access_tier, onboarding_done
  FROM users
  WHERE telegram_id = <TG_NEW_RESPONSIBLE>;
  -- Ожидание: primary_role='responsible', has_responsible_access=true,
  --           responsible_access_tier='standard', onboarding_done=true
  ```
  ```sql
  SELECT code, is_used, used_by, used_at FROM promo_codes WHERE code = '<R-CODE>';
  -- Ожидание: is_used=true, used_by=<id_new_responsible>
  ```

### 0.3 Генерация P-кода у нового Responsible
- На **TG #1 (новый Responsible standard)**: открыть Mini App или бот-меню → создать P-код.
- Запись кода. **БД-проверка:**
  ```sql
  SELECT code, kind, tier, is_used, responsible_id
  FROM promo_codes
  WHERE code = '<P-CODE>';
  -- Ожидание: kind='player', tier='standard', is_used=false,
  --           responsible_id = id нового Responsible (НЕ Aziz)
  ```

---

## 📲 Phase 1 — Onboarding нового Player'а (5 мин)

| # | Действие (с TG #2) | Ожидание | БД-чек |
|---|---|---|---|
| 1.1 | `/start` боту | Welcome + просьба ввести P-код | — |
| 1.2 | Ввести P-код из 0.3 | Бот: «Код принят. Укажи пол» + 2 кнопки | `users` row создан, `pending_promo_id` set |
| 1.3 | Жми пол | Бот: «Уровень подготовки?» + 3 кнопки | `gender` set, `onboarding_state='player_fitness_setup'` |
| 1.4 | Жми fitness | Бот: «Возраст?» | `fitness_level` set, `onboarding_state='player_age_setup'` |
| 1.5 | Жми age | Бот: «Цель?» | `age_range` set, `onboarding_state='player_goal_setup'` |
| 1.6 | Жми goal | Бот: «Готово!» + кнопка «Открыть Mini App» | `goal` set, `onboarding_done=true`, `goal_update_required=false`, `partnerships` row создан |
| 1.7 | Тапни кнопку → откроется Mini App | Видны кубы Action/Market/Profile, БЕЗ чёрного экрана и БЕЗ OnboardingBlockedScreen | `player_access_tier='standard'` |

**После Phase 1 — диагностический SELECT:**
```sql
SELECT u.telegram_id, u.first_name, u.primary_role, u.player_access_tier,
       u.gender, u.fitness_level, u.age_range, u.goal,
       u.onboarding_done, u.goal_update_required,
       p.responsible_id, p.status, p.expires_at
FROM users u
LEFT JOIN partnerships p ON p.player_id = u.id
WHERE u.telegram_id = <TG_NEW_PLAYER>;
```

---

## 🎬 Phase 2 — Workout Session (27 мин)

**Что должно быть видно после фикса BUG-1/BUG-2 (Session 34):**
- На фоне крутится демо-видео упражнения (loop, без `muted` — со звуком если в видео был)
- Камера юзера в маленьком окошке top-right (PiP, mirrored)
- Название упражнения снизу как оверлей
- Между упражнениями — НЕТ попапа с оценкой, переход автоматический

> Открыть параллельно DevTools / Sentry / Railway logs. Если нет — Claude поднимет логи через MCP.

| # | Действие | Ожидание | Что критично |
|---|---|---|---|
| 2.1 | Mini App → ActionCube | Кнопка «Начать тренировку» | UI грузится без ошибок |
| 2.2 | Тапни «Начать» | iOS/Android просит camera permission | Нативный prompt, не глюк |
| 2.3 | Allow camera | Превью камеры на весь экран + кнопка старта | Превью работает в Telegram WebApp |
| 2.4 | Запусти таймер | 35:00 идёт обратный отсчёт | **WakeLock activated** — экран НЕ должен погаснуть |
| 2.5 | Не трогай телефон 5 мин (положи на стол) | Экран остаётся включённым | ❗ Главная проверка WakeLock |
| 2.6 | Сделай 2–3 «упражнения» | Каждые ~30–60 сек видео-клип режется и улетает | Network/Railway: `POST /workout/clip-uploads` → 200 |
| 2.7 | Свернуть Telegram на 30 сек → вернуть | Таймер показывает реальное прошедшее время | Если застрял — баг smart timer |
| 2.8 | Дать сессии завершиться (или досрочно «Стоп»→«Закончить») | «Идёт оценка…» → XP + Капли 💧 | Gemini Vision вернул eval, drops начислены |

**После Phase 2 — БД-чек:**
```sql
-- Сессия завершена? (drops_earned после миграции 026, Session 37)
SELECT id, status, started_at, finished_at, total_score, drops_earned
FROM workout_sessions
WHERE player_id = (SELECT id FROM users WHERE telegram_id = <TG_NEW_PLAYER>)
ORDER BY started_at DESC LIMIT 1;

-- Клипы залились?
SELECT count(*) FROM workout_clips
WHERE session_id = '<SESSION_ID>';

-- Stats обновились?
SELECT global_score, xp_balance, current_streak, last_workout_date
FROM player_stats
WHERE player_id = (SELECT id FROM users WHERE telegram_id = <TG_NEW_PLAYER>);
```

---

## 🛒 Phase 3 — Shop & Boosts (5 мин)

| # | Действие | Ожидание | БД-чек |
|---|---|---|---|
| 3.1 | Mini App → MarketCube | Список бустов/предметов | `shop_items` каталог отдаётся |
| 3.2 | Купить boost (если хватает Stars) | Stars списались, item в инвентаре | `xp_balance` уменьшился, `boosts` row создан |
| 3.3 | Если есть freeze — купить | Аналогично | `users.shop_freeze_balance += 1` |
| 3.4 | (Опц.) С Aziz/Mr. → mentor panel → начислить boost новому player'у | Player получает уведомление | `boosts` row from responsible — НО для standard это будет от **TG #1 (новый responsible standard)**, не от Aziz |

---

## 🌪️ Phase 4 — Edge Cases (5 мин)

### 4.1 Legacy guard (Dol)
| # | Действие | Ожидание |
|---|---|---|
| 4.1.1 | С аккаунта Dol (forcashe) открой Mini App | Должен показаться `OnboardingBlockedScreen` |
| 4.1.2 | Жми «Пройти опрос» | Mini App закрывается → бот шлёт fitness keyboard |
| 4.1.3 | Пройди fitness → age → goal | Бот: ссылка на Mini App |
| 4.1.4 | Открой Mini App у Dol снова | BlockedScreen ушёл, кубы видны |

### 4.2 Сетевой edge
| # | Действие | Ожидание |
|---|---|---|
| 4.2.1 | (Если в Phase 2 успел) Отключить Wi-Fi на 30 сек во время clip-upload | Retry/queue — клипы не теряются |

### 4.3 Tier-limit (опционально)
| # | Действие | Ожидание |
|---|---|---|
| 4.3.1 | TG #1 (Responsible standard) пытается сгенерить ВТОРОЙ P-код или повторно использовать старый | Должен отказать, т.к. standard tier = max 1 player, лимит исчерпан |

---

## 📋 Что вернуть Claude после прогона

По каждому ❌:
1. Phase + step (`Phase 2 шаг 2.5`)
2. Устройство (iPhone X / Android Y)
3. Скрин или текст ошибки
4. Релевантный лог (Railway / browser console / Sentry)

По всем ✅: достаточно `Phase X ok`.

После завершения — Claude обновит `SESSION_STATUS.md` с результатами и переведёт в задаче 7.4 (Telegram Stars payments).

---

## 🧹 Cleanup после теста (опционально, можно отложить)

Два новых аккаунта остаются в БД:
- TG #1 (Responsible standard) — можно оставить для будущих standard-тестов
- TG #2 (Player standard) — можно оставить

Если хочется wipe — отдельная задача, не часть smoke.

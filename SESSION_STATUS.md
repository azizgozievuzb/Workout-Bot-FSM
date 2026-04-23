# SESSION STATUS — Session 26 (2026-04-23) — Этап 4: E2E Acceptance

## ▶️ Следующая точка входа (новый чат) — §12 Legacy cleanup

**Состояние БД после §9 (2026-04-24):**
- Admin (tg=32267272): is_admin=true, responsible_access_tier='elite', shop_freeze=10, gift_freeze=3
- Admin — responsible для P3/oil + Aziz (2 активных партнёрства, ~30d + ~15d)
- Aziz (tg=156453252): dual-role, has_player_access=true, player_access_tier='standard', responsible_access_tier='elite'; player у Admin (15d), responsible для P_F
- P3/oil (tg=8580720783): player, player_access_tier='elite', partnership с Admin (~30d), streak_freeze=2, rest_days=3
- P_F (tg=300099): player, player_access_tier='standard', partnership с Aziz (~15d)

**Состояние БД после §7 (2026-04-23):**
- Admin (tg=32267272, id=d67bdb2c-...): существует, has_responsible_access=true
- **Mr./R1 (tg=7278081310) — УДАЛЁН** в Test 7.4 (CASCADE)
- **Dol/P1 (tg=7458599391) — УДАЛЁН** в Test 7.1 (hard-delete, single partnership)
- Aziz/P2 (tg=156453252, id=db4ab877-...): exists, has_player_access=**false**, has_responsible_access=**true** (dual-role kept)
- oil/P3 (tg=8580720783, id=7077c006-...): exists (partnership с R1 cascade-удалено)
- P_F (tg=300099, id=e115140b-...): exists (partnership с R1 cascade-удалено)
- Миграция 022 применена (duration_days=0 допустим для bonus_pack)

**Хотфиксы сессии 25 (все закоммичены):**
- `83be9b0` — fix(admin): createResponsibleCode → /admin/promo/tier (URL mismatch)
- `1b61ab2` — fix(bot): expires_at отсутствовал в INSERT partnerships через бот
- `(commit)` — fix(auth): own_access_tier вместо legacy access_tier → слот-лимит 1→3
- `db1d6db` — fix(admin): скрыт tier-селектор для Renewal-code генератора
- `8802d05` — fix(renewal): /promo/apply-renewal-player вместо удалённого endpoint
- `5eb61a0` — feat(renewal): per-player renewal + partnership_id в MyPlayer
- `ae8324b` — feat(bot): /upgrade команда для смены тира Ответственного
- `dae7cc2` — feat(promo): авто-удаление истёкших партнёрств при переходе к новому Ответственному
- `4a96a14` — docs: tier downgrade + player re-registration TODOs в SESSION_23_PLAN

**Архитектурные решения принятые в сессии 25:**
- Renewal — per-player (POST /promo/apply-renewal-player). Кнопка "Продлить" у каждого игрока ✅
- Tier change — через /upgrade в боте (Ответственный вводит новый R-код) ✅
- Авто-очистка старых партнёрств при смене Ответственного — реализована ✅
- Tier downgrade (удаление лишних игроков) — TODO в SESSION_23_PLAN §14/15

**Статус TEST_PLAN_SESSION_23.md:**
- §0 TRUNCATE ✅
- §1 Bootstrap (1.1, 1.2, 1.3) ✅
- §2 Slot-limit (2.1, 2.2, 2.5) ✅ | 2.3/2.4 skip
- §3 Renewal (3.1, 3.2, 3.4) ✅ | 3.3/3.5 skip
- §4 Tier change (4.2) ✅ | 4.1/4.3/4.4/4.5 skip
- §5 BonusPack ✅ 10/10 (BUG-A + B2 зафикшены, commit `1d78583`)
- §6 Streak-freeze Jobs ✅ 7/7 (все зелёные, 2026-04-23)
- §7 Partnership DELETE ✅ 4/4 (все зелёные, 2026-04-23)
- §8 Scheduler Jobs F/G ✅ 3/3 (все зелёные, 2026-04-23)
- §9 Auth v2 TokenResponse ✅ 3/3 (9.4 skip — manual; 2026-04-24)
- §10 Ban + Maintenance ✅ 4/4 (2026-04-24)
- §11 Notifications ✅ 4/4 (2026-04-24)
- §12 Legacy cleanup → **СЛЕДУЮЩИЙ**
- §13 Edge Cases
- §14 Final Checklist

**Баги §5 — ЗАФИКШЕНЫ (commit `1d78583`):**

- **BUG-A**: INSERT purchases перемещён ДО DELETE shop_items → FK violation устранён
- **B2**: guard `item.get("player_id") != user_id` → 403 NOT_YOUR_ITEM добавлен

**Уже исправлено (B4):** B4 (GET /shop/items privacy guard) — работает корректно (403)

**Constraint fix:** миграция 022 применена (promo_duration_check теперь допускает 0)

**Известный шум в логах:** `/renewal/my-requests` 404 — убрать в Этапе 3.

---

## ✅ Завершено в сессии 24 (2026-04-23) — Багфикс-волна поверх Backend v2

Закрыты все 7 багов из `SESSION_23_BUGFIX.md` (ревью-архитектор нашёл поверх Backend v2):

- B3 (race на `streak_freeze_balance` в purchase) → commit `8cf6abf`
- B4 (privacy guard на GET /shop/items) → commit `d13a954`
- B5 (rename `resurrect_player_id` → `resurrect_partnership_id`) → commit `9876e68`
- B6 (удалён legacy POST /admin/promo/create) → commit `05788b7`
- B7 (миграция 021: разделение `access_tier` на `responsible_access_tier` + `player_access_tier` в users) → commit `3606397`
- B7b (onboarding.py bot-flow переведён на новые колонки) → commit `4f884b1`
- B8 (Telegram bot push при DELETE /partnerships/{id} + `services/bot_notify.py` + bot singleton через `core/deps.py::get_bot/set_bot`) → commit `2930bcf`
- B9 (admin.py SELECT несуществующих колонок `display_name, username` → SELECT `first_name, telegram_username` с алиасом в Python; API-контракт сохранён для FE) → commit `04910d9`

**Пост-фикс статический ревью** (независимый агент): ГОТОВ К PROD, регрессий нет.

## ▶️ Следующая точка входа (новый чат)

**Этап 4 — Acceptance (ручной E2E прогон через `TEST_PLAN_SESSION_23.md`)**

Backend v2 + багфиксы закрыты. Frontend (Этап 3) НЕ начат, но НЕ требуется для Acceptance — все 15 сценариев Этапа 4 тестируются backend-only:
- Telegram bot flow (реальный `/start` + код)
- Mini App endpoints (curl/HTTPie с JWT)
- DB state — через Supabase MCP
- Scheduler Jobs E/F/G — ручной trigger через Railway shell `python -c "..."`

**Порядок запуска нового чата:**
1. Прочесть `CLAUDE.md` → этот `SESSION_STATUS.md` → `TEST_PLAN_SESSION_23.md` (секции 1–14 + финальный чек-лист §14).
2. TRUNCATE тестовых таблиц в Supabase: `workout_exercises, workout_sessions, ban_history, activity_feed, purchases, boosts, notifications, shop_items, player_stats, partnerships, subscriptions, promo_codes_archive, promo_codes, users` с `RESTART IDENTITY CASCADE`. (Storage-buckets `avatars`/`workout-clips` при необходимости чистить через Dashboard UI.)
3. Пойти по секциям TEST_PLAN последовательно. Для каждой: агент выдаёт SQL precondition → пользователь копирует curl в терминал/Postman → агент подтверждает через Supabase MCP SQL-проверку → ставит `[x]` в финальном чек-листе §14.
4. При регрессии: остановиться → фикс → коммит → перепрогон блока.
5. После всех зелёных → удалить `SESSION_23_BUGFIX.md` и `TEST_PLAN_SESSION_23.md`, оставить только `SESSION_23_PLAN.md` (Этап 3 открыт) и этот STATUS.

**После Acceptance:** переход к Этапу 3 (Frontend refactor 3.1–3.9).

### Техническое состояние DB на точке отключения
- Миграция 021 применена через Supabase MCP, backfill выполнен корректно (dual-role юзеры получили обе колонки).
- Колонка `users.access_tier` оставлена как legacy, будет дропнута в миграции 022 уже после Frontend.
- Railway/Vercel автодеплой активен.

---

## ✅ Завершено в сессии 23 (Backend — этапы 1 → 2.8)
- Этап 1: migration 020_subscription_model_v2.sql → commit `dbf1a98`
- Этап 2.1: admin.py (5 типов промо) → commit `83b87dd`
- Этап 2.2: promo.py (apply-renewal/apply-bonus-pack, resurrect/delete_others) → commit `0c83f7b`
- Этап 2.3: shop.py (per-player лоты, gift-freeze) → commit `c49769a`
- Этап 2.4: partnerships.py (DELETE /{id}, my-players с TTL) → commit `4a2babd`
- Этап 2.5: auth.py (TokenResponse v2) → commit `143c730`
- Этап 2.6: notifications (bus + router + wire emit в shop/promo/partnerships) → commit `e9e2526`
- Этап 2.6.1: POST /player/use-rest-day (female-only) → commit `bfcd16c`
- Hotfix deps: python-multipart для workout /clip → commit `d9b3b00`
- Этап 2.7: Scheduler Jobs E/F/G (subscription_lifecycle.py) → commit `1ed72bd`
- Этап 2.8: TTL → partnerships.expires_at, снесены Jobs A/B/C, удалён renewal router → commit `ec1891a`

**Backend v2 готов.** После сессии 24 (багфикс-волна) — переход к Этапу 4 (Acceptance).

## 📦 Догнано попутно
- Session 20 workout stack (router + vision + migrations 017/019 + frontend) → commit `e70ba4a`
- Legacy cleanup → commit `7efb8a5`

## ▶️ Следующая точка входа (новый чат)
**Этап 3.1 — Frontend Store refactor (`frontend/src/stores/authStore.ts`)**
- Заменить `accessTier` на пару `ownAccessTier` + `playerViewTier`.
- Добавить state: `shopFreezeBalance`, `giftFreezeBalance` (Responsible), `streakFreezeBalance`, `restDaysRemaining` (Player), `hasActivePartnerships` (Responsible), `unreadNotifications` (все), `daysLeft` (Player).
- Геттер `effectiveTier = activeRoleView === 'player' ? playerViewTier : ownAccessTier`.
- LocalStorage persistence для критичных полей (cache hit на старте).
- Миграция всех использований `authStore.accessTier` → `effectiveTier` (в 3.9).

Далее по плану:
- 3.2 API clients (admin/promo/partnerships/shop/notifications)
- 3.3 AdminCube — CodeGeneratorPanel (4 таба)
- 3.4 ResponsibleCube (ActionCube) — wallets, players list, RenewalModal, TierChangeModal, BonusPackModal, GiftFreezeModal
- 3.5 MarketCube — раздельные магазины per player + streak-freeze лоты
- 3.6 PlayerCube (ActionCube) — tier/days/freeze/rest-day UI + manual rest-day button
- 3.7 TierMatrixScreen
- 3.8 Notification Center в BondCube (NotificationList + NotificationRenderer registry)
- 3.9 Global search-replace accessTier → effectiveTier
- Этап 4 — Acceptance tests (из SESSION_23_PLAN.md)
- 2.8 — Cleanup: `core/deps.py` TTL → partnerships.expires_at; снести Jobs A/B/C; удалить `renewal_requests`
- 3.1–3.9 — Frontend refactor
- 4 — Acceptance

---

## ✅ Выполнено в сессии 22 (2026-04-19) — Hotfix: 180-day duration constraint

### Баг
Админ генерировал R-код с Elite VIP + 180 дней → "Ошибка создания кода". Причина: миграция `012_promo_ttl.sql` добавила `CHECK (duration_days IN (7, 30, 90))`. Backend/Frontend уже принимают 180, но БД отклоняла INSERT.

### Фикс
- **`backend/db/migrations/019_promo_duration_180.sql`** (НОВАЯ): DROP + RECREATE constraint → `CHECK (duration_days IN (7, 30, 90, 180))`.
- ✅ Применена в Supabase через MCP.

### Состояние БД на момент отключения
- `users`: 2 (A=player+elite+dual-access, ₳ⱫłⱫ=responsible+elite+dual-access).
- `partnerships`: 2 **взаимных** (A↔₳ⱫłⱫ в обе стороны, status='active').
- `promo_codes`: 6 (3 used, 3 unused).
- **Замечание:** Дублирующиеся взаимные партнёрства могут быть артефактом тестов. При следующем чистом прогоне — TRUNCATE.

---

## ✅ Выполнено в сессии 21 (2026-04-19) — DB Cleanup + Pairing Code Hotfix

### Контекст
После применения миграции 017 (workout_sessions) и создания bucket `avatars` + `workout-clips`, тестовый прогон провалился: `/start` + P-код → 500 на INSERT в `partnerships` (`null value in column "pairing_code" violates not-null constraint`). Причина — после дропа PAIR-флоу в сессии 18 `pairing_code` больше не генерируется, но колонка осталась `NOT NULL`.

### Backend изменения
1. **`backend/db/migrations/018_drop_pairing_code_not_null.sql`** (НОВАЯ) — `ALTER TABLE partnerships ALTER COLUMN pairing_code DROP NOT NULL;`. Применена в Supabase SQL Editor.

### Storage / DB Cleanup
- Buckets `avatars` и `workout-clips` уже пустые (фото не было).
- Полный TRUNCATE по таблицам: `workout_exercises, workout_sessions, ban_history, renewal_requests, activity_feed, purchases, boosts, player_stats, partnerships, subscriptions, promo_codes_archive, promo_codes, users` с `RESTART IDENTITY CASCADE`.
- Прогон прошёл: `/start` + ADMIN_PROMO_CODE → admin → P-код (PE…) → второй TG-аккаунт `/start` + PE… → партнёрство создаётся без 23502.

### Известные нюансы
- `storage.objects` нельзя чистить через `DELETE FROM storage.objects` напрямую (триггер `protect_delete` + owner=`supabase_storage_admin`). Для очистки storage — Dashboard UI или Storage API под Service Role Key.
- Миграция 017 применена, но end-to-end тренировочный loop с Gemini ещё не прогонялся.

### 🔜 Первое действие следующей сессии
1. Прогнать full workout loop на реальном Telegram: старт → 2-3 подхода → finish → проверить `workout_sessions`/`workout_exercises`/`player_stats.star_balance`.
2. Если Gemini video-input не работает на 2.5-flash — переключить `MODEL_PRIMARY` в `backend/services/workout_vision.py` на `gemini-2.0-flash`.
3. Далее: Админ-архитектура (NULL partnership как Игрок) ИЛИ переработка Маркета — спросить пользователя.

---

## ✅ Выполнено в сессии 20 (2026-04-19) — Workout Session Interface (200_workoutSessionMachine)

### Архитектура
- **FSM-контракт 1:1** с `fsm_blueprints/200_workoutSessionMachine.ts`, но без xstate — `useReducer` в `frontend/src/fsm/workoutSessionMachine.ts`.
- **Разделение слоёв**:
  - FSM (pure reducer) — `frontend/src/fsm/workoutSessionMachine.ts`
  - Hardware (Camera + MediaRecorder + WakeLock + таймер) — inside `WorkoutScreen.tsx`
  - API — `frontend/src/api/workout.ts`
  - UI/CSS — `WorkoutScreen.css` (Telegram theme vars, mobile-first, safe-area insets)
- **Контракт BE↔FE**: `backend/core/workout_config.py` — единый источник `EXERCISES[16]`, длительностей фаз, MAX_STARS. FE забирает через `GET /workout/config`.

### Backend изменения
1. **`backend/db/migrations/017_workout_sessions.sql`** (НОВАЯ) — таблицы `workout_sessions` (status: in_progress|finished|cancelled, total_score, stars_earned) + `workout_exercises` (UNIQUE session_id+exercise_idx, ai_score 0..100, feedback). Индексы + CHECK constraints.
2. **`backend/core/workout_config.py`** (НОВАЯ) — dataclass `Exercise`, 16 упражнений, константы `PREPARE_SEC=5 / EXERCISE_SEC=40 / REST_SEC=90 / REVIEW_SEC=5`, `MAX_STARS_PER_SESSION=50`.
3. **`backend/services/workout_vision.py`** (НОВАЯ) — Gemini Vision async `analyze_exercise_clip(video_bytes, mime, Exercise) -> {score, feedback}`; `gemini-2.5-flash` → fallback `gemini-2.0-flash`; JSON-only response; tolerant parse; never raises (возвращает 0 при ошибке).
4. **`backend/api/routers/workout.py`** (НОВЫЙ) — `GET /workout/config`, `POST /workout/start` (убивает stale in_progress), `POST /workout/clip` (multipart → Storage bucket `workout-clips` + Gemini), `POST /workout/finish` (считает total/avg/stars, апдейтит `player_stats.star_balance` + streak), `POST /workout/cancel`. Только role=player.
5. **`backend/main.py`** — зарегистрирован `workout_router`.

### Frontend изменения
1. **`frontend/src/api/workout.ts`** (НОВЫЙ) — `getWorkoutConfig`, `startWorkoutSession` (отправляет tz_offset_min), `uploadWorkoutClip` (multipart, timeout 90s), `finishWorkoutSession`, `cancelWorkoutSession`.
2. **`frontend/src/fsm/workoutSessionMachine.ts`** (НОВЫЙ) — useReducer FSM, типы `WorkoutState/Event/Context`, 1:1 с blueprint.
3. **`frontend/src/components/workout/WorkoutScreen.tsx`** (НОВЫЙ) — fullscreen z-index 9999; `getUserMedia({facingMode:'user'})` в idle→start; WakeLock + re-acquire на visibilitychange; MediaRecorder 1.5 Mbps (vp9→vp8→mp4 fallback); phase timer 250ms тик; upload верdict приходит во время rest-фазы; `aiVerdictReview` showing score+feedback; `finishSession` → `/workout/finish` + звёзды; кнопка × → `/workout/cancel`. Haptic feedback на все переходы.
4. **`frontend/src/components/workout/WorkoutScreen.css`** (НОВЫЙ) — mobile-first, Telegram theme vars, `env(safe-area-inset-*)`, REC-dot pulse animation, phase-specific badges, центральная карточка c backdrop-blur.
5. **`frontend/src/components/cubes/ActionCube.tsx`** — кнопка «Приступим» → `setWorkoutOpen(true)` → `<WorkoutScreen onClose={...} />` (portal через fixed-inset). Добавлен `workoutOpen` state + handler с haptic.

### Stack проверки
- ✅ `npx tsc --noEmit -p tsconfig.json` → exit 0 (типы зелёные)

### Pending перед деплоем
1. Применить миграцию `017_workout_sessions.sql` в Supabase SQL Editor.
2. Создать bucket `workout-clips` в Supabase Storage (private, policies optional для MVP).
3. Убедиться, что `GEMINI_API_KEY` (Railway env) имеет доступ к `gemini-2.5-flash` video input.

### Acceptance Criteria
1. Player → ActionCube → «Приступим» → запрос камеры → экран idle «Готовы?»
2. «Начать» → preparePhase 5s countdown → exercisingPhase 40s с REC-точкой → restAndAnalyzingPhase 90s (во время отдыха приезжает verdict)
3. aiVerdictReview: показывается score% + feedback + «Дальше»
4. После 16го подхода → finishSession → `/workout/finish` → `total_score`, `stars_earned`, `player_stats.star_balance += stars`, `last_workout_date=today`, `current_streak` инкрементируется корректно
5. Кнопка × в любой момент → `/workout/cancel` → `status='cancelled'`, `finished_at=now`, камера/wakelock отпускаются
6. Stale in_progress сессия при повторном старте автоматически cancel'ится

### Коммит
- Не закоммичено (пуш локально).

### 🔜 Первое действие следующей сессии
1. Применить миграцию 017 + создать Storage bucket `workout-clips` (см. Pending).
2. Прогнать full loop на реальном Telegram: старт → 2-3 подхода → finish → проверить `workout_sessions`/`workout_exercises`/`player_stats.star_balance`.
3. Если Gemini video-input не работает на 2.5-flash — переключить `MODEL_PRIMARY` в `backend/services/workout_vision.py` на `gemini-2.0-flash`.
4. Далее: Админ-архитектура (NULL partnership как Игрок) ИЛИ переработка Маркета — спросить пользователя.

---

## ✅ Выполнено в сессии 19 (2026-04-18) — Allow Player P-Code Activation Directly in Bot

### Архитектурные изменения
- **Reverse Matryoshka Guard**: P-код раньше отвергался в боте и требовал активации в мини-апп. Теперь P-код активируется прямо в боте, создавая:
  - User row с role='player'
  - Partnership (player ↔ responsible)
  - Mark promo_code as used + set expires_at
  - Auto-regenerate свежий P-код для Ответственного

### Изменения кода

1. **`backend/services/fsm/onboarding_fsm.py`** → `validate_promo_code()`
   - Убран reject `"reason": "code_is_player"`
   - Вместо этого возвращает `{"ok": True, "role": "player", "promo_id": ..., "responsible_id": ..., "access_tier": ..., "duration_days": ..., "tier": ...}`
   - Добавлен `"role": "responsible"` для R-кодов
   - Добавлен `"role": "admin"` для ADMIN_PROMO_CODE

2. **`backend/handlers/onboarding.py`** → text handler
   - Удалена ветка `elif promo_result.get("reason") == "code_is_player"` (строки 327-334)
   - Добавлена новая ветка **player code activation** (120+ строк):
     - Self-invite guard (нельзя использовать свой код)
     - Fetch responsible (name + access_tier для slot limit)
     - Проверка slot limit по tier (standard=1, premium=2, elite=3)
     - Upsert player user row (role='player', has_player_access=True)
     - Атомарный mark code used (с `.eq("is_used", False)` guard от race condition)
     - Create partnership (active)
     - Auto-regen fresh P-код для Responsible (inherit tier)
     - Ответ: "Вы зарегистрированы как Игрок у {name}. Откройте приложение" + mini-app button
   - Moved `tier` extraction ПОСЛЕ admin+player веток (перед responsible блоком)
   - Добавлен импорт `timedelta`

### Acceptance Criteria
1. ✅ TRUNCATE BD → Admin через ADMIN_PROMO_CODE в боте → role='admin', access_tier='elite', P-код (PE…)
2. ✅ Новый TG-аккаунт `/start` + P-код (PE…) → бот отвечает "Вы зарегистрированы как Игрок у {admin_name}. Откройте приложение" + mini-app button
3. ✅ В БД: users (role='player', has_player_access=True), partnership (active), promo_codes (is_used=True, expires_at set), новый PE…-код для админа
4. ✅ Mini App открывается → `/auth/telegram` вернёт role='player' (не 'new') → PhotoGate сразу (без promo screen)
5. ✅ Повторная активация того же кода → "Этот код уже был активирован" (race guard `.eq("is_used", False)`)
6. ✅ Self-activate: player вводит свой же PE-код → "Нельзя использовать свой собственный код"

### Коммит
- `2554605` — `feat(bot): activate player P-codes directly in bot, skip mini-app promo input`
- ✅ `git push` выполнен (Railway + Vercel деплой триггерятся автоматически)

---

## ✅ Выполнено в сессии 18 (2026-04-18) — Drop Legacy PAIR Flow, Always Prefix Codes, Clean Stale Codes

### Архитектурные изменения
- **Bot Responsible Flow**: было `promo_code → language → gender → player_name → PAIR_link`; теперь `promo_code → create user + P-code → Mini App`
- **Матёшка защита 2.0**: старые беспрефиксные P-коды (`2TEBUU1C`, `MJ00L469` и т.д.) инвалидируются автоматически при вызове `create_player_invite_code()`
- **ActionCube chip**: теперь всегда показывает только корректные `P{S|P|E}XXXXXX` коды

### Изменения кода

1. **`backend/services/fsm/onboarding_fsm.py`** → `create_player_invite_code()`
   - Инвалидирует все неиспользованные P-коды, которые НЕ соответствуют `P<tier_letter>` + 8 chars
   - Фильтрует `valid` коды перед возвратом
   - Если есть валидный → возвращает его; иначе создаёт новый

2. **`backend/api/routers/promo.py`** → `GET /promo/my-player-code`
   - Добавлен фильтр `.like("code", "P%")` (safety net)
   - `.order("created_at", desc=True)` + `.limit(1)` для консистентности

3. **`backend/handlers/onboarding.py`** → text handler (responsible promo)
   - **Удалено**: `resp_language` → `resp_gender` → `resp_player_name` → `generate_pair_code()` (PAIR flow)
   - **Добавлено**: Сразу после валидации R-кода:
     - Upsert user с `onboarding_done=True`, `onboarding_state="onboardingComplete"`
     - Mark R-promo as used (is_used=True)
     - Call `create_player_invite_code()` → генерирует P-код (`PS…/PP…/PE…`)
     - Ответ: показывает P-код в коде + кнопка Mini App
   - **Удалено**: весь блок `resp_player_name` handler (459-499 строк старого файла)
   - Добавлен импорт: `from datetime import datetime, timezone`

### Acceptance
1. ✅ Admin `/start` → ADMIN_PROMO_CODE → "Добро пожаловать, Админ!" + Mini App (без изменений)
2. ✅ Responsible `/start` → R-код (RS/RP/RE) → **БЕЗ language/gender/name** → "Вы теперь Ответственный. Ваш код для приглашения: **PE/PS/PP + 6 chars**" + Mini App
3. ✅ Mini App → ActionCube chip показывает тот же `P{S|P|E}XXXXXX`
4. ✅ Другой аккаунт вводит этот P-код в Mini App → становится Игроком (наследует tier от Ответственного)
5. ✅ Старые беспрефиксные коды в БД не всплывают (инвалидируются при `create_player_invite_code()`)
6. ✅ `npm run build` в frontend/ прошёл успешно

### Коммит
- `a321f7e` — `fix(onboarding): drop legacy PAIR flow, always prefix player codes, clean stale codes`
- ✅ `git push` выполнен (Railway + Vercel деплой триггерятся автоматически)

---

## ✅ Выполнено в сессии 17 (2026-04-18) — Code Prefixes + Matryoshka Fix + Admin=Elite + Backdrop Raw-Photo Fix

### Архитектура кодов
- **R-код** (ответственный): `R<tier><6 rnd>` → `RS…/RP…/RE…`
- **P-код** (игрок): `P<tier><6 rnd>` → `PS…/PP…/PE…`
- **RN-код** (продление): `RN<tier><5 rnd>` → `RNS…/RNP…/RNE…`
- **Tier letter:** S=Standard, P=Premium, E=Elite
- **Admin** всегда получает `access_tier='elite'` (его P-коды → `PE…`)
- **Player**, вошедший по P-коду, наследует `access_tier` своего Ответственного

### 🐛 Исправленные баги

1. **Матрёшка** (критично): P-код, введённый в боте, делал юзера Ответственным.
   - `backend/services/fsm/onboarding_fsm.py::validate_promo_code`: теперь селектит `code_type, access_tier`. Если `code_type='player'` — возвращает `reason='code_is_player'` и НЕ даёт активировать в боте.
   - `backend/handlers/onboarding.py`: на `code_is_player` бот отвечает «Это код Игрока. Откройте приложение» + кнопка Mini App.

2. **Админ → Elite автоматом**:
   - `backend/handlers/onboarding.py` (bot): при активации ADMIN_PROMO_CODE ставит `users.access_tier='elite'`; генерация P-кода с `access_tier='elite'` (→ PE…).
   - `backend/api/routers/promo.py::activate_promo` (mini-app): тот же fix для ADMIN_PROMO_CODE пути.

3. **Наследование tier P-кодом**:
   - Ответственный активирует R-код → создаваемый P-код наследует `access_tier` из R-кода.
   - `_activate_player_code` авто-регенерирует P-код с `access_tier=code_tier` (не дефолтный standard).

4. **Префиксы по всей системе**:
   - `promo.py::_create_player_code` → `_generate_prefixed_code("P", access_tier)`.
   - `admin.py` → новые хелперы `_gen_prefixed("R"|"P", tier)` и `_gen_renewal(tier)`; все роуты (`/admin/promo/responsible`, `/admin/promo/renewal`, `/admin/codes/batch-buy`, bot `/new_promo`) используют их.
   - `onboarding_fsm.py::create_player_invite_code` принимает `access_tier`, генерит `P<letter>…`.

5. **Backdrop: сырое фото на фоне**:
   - `frontend/src/design/backdrop/Backdrop.tsx`: убран промежуточный `photoUrl` из `faceSrc` — до готовности обработанного `photoDarkUrl/photoLightUrl` показывается дефолт (`womanCosmic/womanMeditating`), а не сырой аватар. Плавный кроссфейд в итоговое тематическое фото.

### API изменения
- `GET /promo/my-player-code` теперь возвращает `access_tier` → ActionCube показывает правильный TierBadge на чипе.
- `MyPlayerCodeResponse.access_tier: str | None` (frontend `AccessTier | null`).

### Стек
- Backend: `backend/services/fsm/onboarding_fsm.py`, `backend/handlers/onboarding.py`, `backend/api/routers/promo.py`, `backend/api/routers/admin.py`.
- Frontend: `frontend/src/design/backdrop/Backdrop.tsx`, `frontend/src/api/promo.ts`.

### Проверка (acceptance)
1. Admin `/start` + ADMIN_PROMO_CODE → `users.access_tier='elite'`, P-код в Action начинается с `PE`.
2. Другой TG-аккаунт `/start` + P-код (`PE…`) → бот отвечает «Это код Игрока. Откройте приложение» (НЕ делает его Ответственным).
3. Аккаунт открывает Mini App, вводит `PE…` → становится Игроком (Elite), партнёрство создаётся.
4. Новый P-код после активации — тоже `PE…`.
5. Фон: при открытии Mini App сырое фото не мигает — сразу видно тематизированное (или дефолт-арт).

### Commit / Deploy
- ✅ `git push` выполнен (Railway + Vercel деплой триггерятся автоматически)
- Commit message: `fix(codes): R/P/RN prefixes with tier letter, admin=elite, reject player code in bot, inherit access_tier; fix(backdrop): no raw-photo flash`

### ⚠️ Важно для следующей сессии
- Старые неиспользованные P-коды в БД (без префикса, напр. `MJ00L469`) остаются как есть — новые коды идут с префиксами (`PE…`, `PS…`). Для чистого теста: TRUNCATE `promo_codes` или у каждого Ответственного нажать «Обновить» в Action (это инвалидирует старые unused P-коды и создаёт новые с префиксом).
- Миграция БД не требуется — `access_tier` колонка уже есть (миграция 014).

---

## ✅ Выполнено в сессии 16 (2026-04-18) — Epic 6: Stars/Crypto Coming-Soon UI Stubs

### Frontend
- **`frontend/src/components/shared/BuyCodesModal.tsx`**: добавлена `handleComingSoon()` функция + секция с 3 кнопками оплаты (Free, Stars, Crypto) перед submit-кнопкой; Free — active state, Stars/Crypto — disabled с haptic warning + toast
- **`frontend/src/components/shared/BuyCodesModal.css`**: добавлены стили `.payment-methods*`, `.payment-method*` — flex layout, Telegram theme vars, opacity для disabled кнопок
- **`frontend/src/components/cubes/MarketCube.tsx`**: в `PlayerShop` добавлена секция `.market-payment-hint` сверху с двумя "Coming Soon" строками (Stars + Crypto)
- **`frontend/src/styles/cubes.css`**: добавлены стили `.market-payment-hint*` — flex layout, opacity 0.75, theme-aware цвета

### Build
- ✓ `npm run build` green в `frontend/`

### Коммит
`feat(payment): Stars/Crypto coming-soon stubs in BuyCodesModal + MarketCube`

### Тестирование (acceptance criteria)
1. Admin → Промокоды → Купить пачку → видит 3 кнопки: Free (active 🎁), Stars (disabled ⭐ скоро), Crypto (disabled 💎 скоро)
2. Тап Stars/Crypto → haptic warning + toast "Stars оплата — скоро" / "Crypto оплата — скоро" на 2.5s
3. Player → Market → видит две "Coming Soon" строки сверху (opacity 75%)
4. Светлая/тёмная тема корректны (CSS vars)

---

## ✅ Выполнено в сессии 15 (2026-04-18) — Admin Screen II: Stats, BuyCodes, Ban History

### Backend
- **`backend/db/migrations/016_ban_history.sql`**: CREATE TABLE `ban_history` (user_id, banned_by, banned_at, ban_until, reason, missed_workouts, unbanned_early_at); индексы по user_id + banned_at
- **`backend/api/routers/admin_settings.py`**: `BanUserReq.days` default=2; `ban_user` теперь INSERT в `ban_history` (с lookup admin UUID); `unban_user` UPDATE `ban_history.unbanned_early_at` для активной записи (filter `ban_until > now` + `unbanned_early_at IS NULL`)
- **`backend/api/routers/admin.py`**: новые модели `PlayerStats`, `ResponsibleStats`, `BatchBuyReq/Resp`, `BanHistoryEntry/Response`; `PlayerInPair` + `stats: PlayerStats | None`; `ResponsibleGroup` + `stats: ResponsibleStats | None`; `/admin/connections` — bulk-fetch `player_stats` (single query, no N+1), вычисление `completion_rate = min(1.0, global_score / days_since_join)`, агрегация `ResponsibleStats`; новый `POST /admin/codes/batch-buy` (bulk INSERT N кодов одной транзакцией, `total_stars_cost=0` заглушка); новый `GET /admin/bans/history` (последние 50 + активные старше 30 дней, bulk-fetch user info)

### Frontend
- **`frontend/src/api/admin.ts`**: новые интерфейсы `PlayerStats`, `ResponsibleStats`, `BanHistoryEntry`, `BatchBuyRequest/Response`, `BatchCodeType`; функции `batchBuyCodes()`, `getBanHistory()`
- **`frontend/src/components/shared/BuyCodesModal.tsx`** (новый): bottom-sheet; tab Responsible/Player/Renewal; chip-buttons тир/длительность/количество; bulk generate → список кодов + copy-all + поштучно; haptic success
- **`frontend/src/components/shared/BuyCodesModal.css`** (новый): стили bottom-sheet, chips, batch-buy-result
- **`frontend/src/components/shared/BanUserModal.tsx`**: default days=2; preset chips «2 дня (стандарт)/7/14/30»; hint «Игрок увидит причину на экране блокировки»
- **`frontend/src/components/shared/BanUserModal.css`**: `.ban-modal-presets`, `.ban-modal-preset-btn`, `.ban-modal-hint`
- **`frontend/src/components/cubes/AdminCube.tsx`**: 4й таб «Баны»; `BanHistoryPanel` с фильтрами (Все/🔴 Активен/⚪ Истёк/🟢 Снят), аккордеон с reason+missed+кнопкой Разбанить; `ConnectionsPanel` — переключатель Карточки|Таблица; таблица с горизонтальным скроллом, sticky первый столбец, аккордеон по R-строке показывает P-строки с ⋮-меню; карточки показывают completion_rate mini-progressbar; `PromosPanel` — кнопка «Купить пачку» → `BuyCodesModal`; `CompletionBar` mini-компонент
- **`frontend/src/styles/cubes.css`**: `.connections-view-switcher`, `.connections-view-btn`, `.connections-table-wrap`, `.connections-table`, `.connections-expand-icon`, `.completion-bar-*`, `.ban-history-*`, `.ban-status-badge-*`, `.ban-filter-btn`

### Коммит
`898312c` — feat(admin): R↔P stats table, batch code purchase, ban history panel

### Pending (не в scope этой сессии)
- Применить миграцию `016` в Supabase SQL Editor
- Telegram Stars оплата для batch-buy (Epic 6)
- Графики/чарты по аналитике

---

## ✅ Выполнено в сессии 14 (2026-04-18) — Maintenance Mode UX + Ban/Unban Flow

### Backend
- **`backend/api/routers/admin_settings.py`**: новый GET `/admin/maintenance/status` (`MaintenanceStatusResp`: `maintenance_mode`, `started_at`, `frozen_seconds`)
- **`backend/api/routers/admin.py`**: `PlayerInPair` расширен полями `id: str`, `is_banned: bool`, `ban_until: str | None`; bulk-fetch `ban_until` из users (single query, no N+1); добавлен `from datetime import datetime, timezone`
- **`backend/api/routers/auth.py`**: `TokenResponse` + `ban_until`, `ban_reason`, `ban_missed`; SELECT добавлены `ban_until, ban_reason, ban_missed_workouts`; при `/auth/telegram` если бан активен — поля заполняются

### Frontend
- **`frontend/src/api/admin.ts`**: `PlayerInPair` + `id`, `is_banned`, `ban_until`; новые `MaintenanceStatus` + `getMaintenanceStatus()`
- **`frontend/src/stores/authStore.ts`**: `BanInfo.until` и `BanInfo.reason` стали `string | null`
- **`frontend/src/api/client.ts`**: 403 BANNED interceptor — `until` и `reason` nullable
- **`frontend/src/hooks/useAuth.ts`**: после `/auth/telegram` — если `data.ban_until` есть → `setBanInfo()` сразу (BanScreen без ожидания 403)
- **`frontend/src/components/shared/MaintenanceScreen.tsx`** + **`.css`**: SVG шестерёнка с `@keyframes rotate 4s`, живой счётчик `Заморожено: HH:MM:SS`, Telegram theme vars, zero inline styles
- **`frontend/src/components/shared/BanScreen.tsx`** + **`.css`**: карточка с причиной, `Осталось: N дн./ч./мин.`, auto-reload при истечении бана, `var(--tg-theme-destructive-text-color)` акцент без агрессивного фона
- **`frontend/src/components/shared/BanUserModal.tsx`** + **`.css`**: bottom-sheet, days [1,3,7,14,30], textarea, missed [0..10], swipe-down dismiss, haptic warning
- **`frontend/src/components/cubes/AdminCube.tsx`**: 3 таба (Промокоды | Соединения | Настройки); `SettingsPanel` с toggle-switch, frozen-timer, confirm-диалог, polling 30s; `ConnectionsPanel` с ⋮-меню на каждом игроке (Забанить/Разбанить), `opacity:0.4` + `🚫` для забаненных; `PromoListPanel` + `CodeGeneratorPanel` вынесены отдельно
- **`frontend/src/styles/cubes.css`**: `.settings-panel`, `.settings-row`, `.toggle-switch`, `.frozen-timer`, `.settings-confirm`, `.player-context-menu`, `.player-context-menu-item`, `.maintenance-admin-banner`
- **`frontend/src/App.tsx`**: `maintenanceMode && !is_admin` (было `role !== 'admin'`); плавающий banner для admin при активном maintenance (клик → Admin куб)

### Коммит
`feat(maintenance): admin toggle UI, ban/unban flow, polished block-screens`

---

## ✅ Выполнено в сессии 13 (2026-04-18) — Player Renewal Reversal

### Архитектурный принцип
Player больше НЕ вводит renewal-коды. Вместо этого — кнопка «Попросить Ответственного продлить», которая создаёт запись в `renewal_requests`. Ответственный в своём ActionCube видит badge-уведомление и применяет renewal-код (полученный от Админа) к конкретному Игроку.

### Backend
- **`backend/api/routers/renewal.py`** (новый): `POST /renewal/request` (Player→Responsible, cooldown 24h с 429 + created_at в detail), `GET /renewal/my-requests` (Responsible видит unresolved)
- **`backend/api/routers/promo.py`**: новый endpoint `POST /promo/renew-player` (валидация partnership + tier match + атомарный mark code is_used + UPDATE активной promo_codes строки Player: expires_at = GREATEST(current, now) + duration_days; если активной нет — INSERT reactivation; resolve renewal_requests)
- **`backend/api/routers/partnerships.py`**: новый endpoint `GET /partnerships/my-players` (возвращает для Responsible список игроков с id, first_name, profile_photo_url, access_tier, days_left, is_deactivated)
- **`backend/main.py`**: зарегистрирован `renewal_router`

### Frontend
- **`frontend/src/api/renewal.ts`** (новый): `createRenewalRequest()`, `listMyRenewalRequests()`, `listMyPlayers()`, `renewPlayer(player_id, code)`
- **`frontend/src/components/cubes/ActionCube.tsx`**:
  - **PlayerView**: renewal-prompt блок при `days_left <= 7 && is_active`; кнопка «Попросить Ответственного продлить» → `createRenewalRequest()` + `hapticNotification('success')`; requestPending персистится в localStorage (`wb_renewal_pending_until`, 24h); 429 cooldown показывает message и включает pending state
  - **ResponsibleView**: секция «Мои Игроки» (заменяет прежний `/stats/partner`); каждая строка с TierBadge + days_left + pulse-анимацией при `requestsByPlayer[p.id]` + текст «🔔 Просит продлить (N мин назад)»; кнопка «Продлить» открывает `RenewalModal`; polling `listMyRenewalRequests()` каждые 60с + на visibilitychange
- **`frontend/src/components/renewal/RenewalModal.tsx`** (новый): input + submit, обработка `CODE_INVALID`/`TIER_MISMATCH`/`NOT_YOUR_PLAYER`/`RACE` с понятными сообщениями; haptic feedback; toast «Продлено на N дн.» через `onSuccess`
- **`frontend/src/styles/cubes.css`**: добавлены `.renewal-prompt`, `.player-row`, `.player-row--has-request` (с `@keyframes renewal-pulse`), `.renewal-modal`, `.renewal-modal__backdrop`, все используют Telegram theme vars

### Что НЕ сделано (scope control)
- Telegram bot-уведомления Ответственному (только in-app badge)
- Админ Screen II (Epic 5)
- Stars/Crypto (Epic 6)

### Коммит
- [см. git log]

---

## ✅ Выполнено в сессии 12 (2026-04-18) — Haptic Feedback Migration

### Что сделано
- **`frontend/src/utils/haptic.ts`** (новый): утилита-обёртка над singleton `hapticFeedback` из `@telegram-apps/sdk-react` с функциями `hapticImpact()`, `hapticNotification()`, `hapticSelection()` + `ensureMounted()` гвард
- **`frontend/src/components/cubes/AdminCube.tsx`**: замена импорта `useHapticFeedback` на `hapticImpact`; удаление хука и его из dependency arrays; build успешен

### Коммит
- `71de5ce` — fix(haptic): replace useHapticFeedback hook with singleton API

---

## ✅ Выполнено в сессии 11 (2026-04-18) — Admin Code Generator + ActionCube cleanup

### Что сделано
- **`backend/api/routers/admin.py`**: два новых эндпоинта `POST /admin/promo/responsible` (R-код с tier+duration) и `POST /admin/promo/renewal` (renewal P-код); схемы `CreateResponsibleCodeReq/Resp`, `CreateRenewalCodeReq/Resp`; используют `Depends(require_admin)`
- **`frontend/src/api/promo.ts`**: добавлены тип `DurationDays`, функции `createResponsibleCode()` и `createRenewalCode()`
- **`frontend/src/components/common/TierBadge.tsx`**: новый компонент (STD/PRM/ELT чип с цветовой кодировкой)
- **`frontend/src/components/cubes/AdminCube.tsx`**: полная замена кнопки-генератора на форму с TabSelector (R-код / Renewal-код), TierSelector, DurationSelector, haptic feedback, code-display с TierBadge
- **`frontend/src/components/cubes/ActionCube.tsx`**: удалён duration selector, `selectedDuration` state, `DURATION_OPTIONS`, `handleGenerateCode`, импорт `createNewPlayerCode`; добавлен `TierBadge` рядом с кодом; вместо duration-row — кнопка «Обновить»
- **`frontend/src/styles/cubes.css`**: удалены `.promo-duration-row`, `.promo-duration-btn`, `.promo-duration-btn.active`; добавлены `.tier-badge-*`, `.admin-generator-form`, `.tab-selector`, `.code-display`

### Коммит
- `6b6c752` — feat(admin): tier+duration generator, remove ActionCube duration selector

---

## ✅ Выполнено в сессии 10 (2026-04-18) — Foundation: AccessTier, Bans, Maintenance, RenewalRequests

### Что сделано
- **Миграции 014 + 015** (Supabase): `access_tier` enum, `promo_codes.access_tier/is_renewal`, `users.access_tier/ban_until/ban_reason/ban_missed_workouts`, таблицы `app_settings` + `renewal_requests`, функция `extend_active_promos_by_seconds()`
- **`backend/core/deps.py`**: Ban-check (403 BANNED) + Maintenance-check (503 MAINTENANCE) до TTL-проверки; `_get_app_settings()` с 30-сек кешем через `time.monotonic()`; `require_admin` dependency; `_invalidate_settings_cache()`
- **`backend/api/routers/admin_settings.py`** (новый): `POST /admin/maintenance/toggle` (freeze/unfreeze TTL), `POST /admin/users/{id}/ban`, `POST /admin/users/{id}/unban`
- **`backend/main.py`**: зарегистрирован `admin_settings_router`
- **`backend/api/routers/promo.py`**: `_activate_player_code` копирует `access_tier` в `users`; `new_player_code` наследует tier от R-кода Responsible; cap duration `{7,30,90,180}`; `_create_player_code` принимает `access_tier`
- **`frontend/src/api/promo.ts`**: `access_tier`, `is_renewal` в `MyPlayerCodeResponse`; экспортирован тип `AccessTier`
- **`frontend/src/api/admin.ts`**: `toggleMaintenance()`, `banUser()`, `unbanUser()`
- **`frontend/src/stores/authStore.ts`**: `maintenanceMode`, `banInfo: BanInfo|null`, `accessTier`, сеттеры; типы `AccessTier`, `BanInfo`
- **`frontend/src/api/client.ts`**: interceptor 403 BANNED → `setBanInfo()`; 503 MAINTENANCE → `setMaintenanceMode(true)`
- **`frontend/src/components/shared/MaintenanceScreen.tsx`** (новый): полноэкранный блок-экран техработ
- **`frontend/src/components/shared/BanScreen.tsx`** (новый): полноэкранный блок-экран бана
- **`frontend/src/App.tsx`**: `banInfo` → `<BanScreen>`, `maintenanceMode && role!='admin'` → `<MaintenanceScreen>` (до accessRevoked)

### Коммит
- `feat(foundation): access tiers, bans, maintenance mode, renewal requests`

---

## ✅ Выполнено в сессии 9 (2026-04-17) — Promo bug fixes + duration logic

### Что сделано
- `backend/api/routers/promo.py`: безопасный fallback для `code_type` (инферируется из `responsible_id` если колонка NULL) + авто-регенерация player-кода после активации
- Новый эндпоинт `POST /promo/new-player-code` с параметром `duration_days: 7|30|90`
- `frontend/src/api/promo.ts`: добавлен `createNewPlayerCode()`
- `frontend/src/components/cubes/ActionCube.tsx`: refresh кода по `visibilitychange` + (временно) duration selector — **требует рефакторинга** (см. открытые вопросы)
- `frontend/src/styles/cubes.css`: стили для duration selector
- `backend/db/migrations/013_code_type_not_null.sql`: фикс NULL-записей + NOT NULL constraint

### Коммит
- `aa259ea` — fix: wrong role on player code activation + duration selector + auto-regenerate

---

## ⚠️ ОТКРЫТЫЕ ВОПРОСЫ (НАПОМНИТЬ В НАЧАЛЕ СЛЕДУЮЩЕЙ СЕССИИ)

### 3. Архитектура Админа (ОТЛОЖЕНО)
NULL partnership как Игрок — полная реализация отложена.

### 4. Глобальная переработка Маркета (ОТЛОЖЕНО)

---

## ✅ Выполнено в сессии 8 (2026-04-17) — Code Review: 3 Blockers + 7 Warnings Fixed

### Контекст
Code review (Claude Sonnet 4.6 Cowork, `/review-pr`) обнаружил **3 блокера** и **7 варнингов** за последние 25 коммитов / 46 файлов. Все исправлены и закоммичены (`006b0da`).

### 🚫 Блокеры (исправлены)

**1. Race condition — shop balance double-spend**
- **Файл:** `backend/api/routers/shop.py` (line ~101-114)
- **Проблема:** read balance → check → update без атомарности. Два параллельных запроса оба проходят проверку.
- **Фикс:** Оптимистичная блокировка `.eq("star_balance", balance)` в UPDATE. Если баланс изменился → 409 Conflict.

**2. Race condition — promo is_used double activation**
- **Файл:** `backend/api/routers/promo.py` (2 места: `_activate_player_code` и `activate_promo` responsible block)
- **Проблема:** SELECT is_used → check → UPDATE is_used=True — не атомарно.
- **Фикс:** `.eq("is_used", False)` на UPDATE. Только одна из параллельных активаций побеждает, вторая получает 409.

**3. `.single()` crash на отсутствующих записях**
- **Файлы:** `backend/services/fsm/onboarding_fsm.py:363`, `backend/api/routers/promo.py:143`
- **Проблема:** `.single()` бросает PostgRESTError если записи нет → 500.
- **Фикс:** `.maybe_single()` + guard с `return None` / `raise HTTPException(404)`.

### ⚠️ Варнинги (исправлены)

| # | Файл | Что исправлено |
|---|------|----------------|
| 1 | `frontend/src/App.tsx` | Dead import `AccessRevokedScreen` → теперь используется как компонент вместо inline div |
| 2 | `backend/api/routers/admin.py` | N+1 queries (50 resp → 101 queries) → 3 bulk queries + `.eq("has_responsible_access", True)` вместо `.eq("role", "responsible")` |
| 3 | `backend/core/deps.py` | `_revoked_logged: set` (unbounded memory leak) → `@lru_cache(maxsize=1024)` |
| 4 | `backend/api/routers/promo.py` | Восстановлена проверка `expires_at` для responsible-кодов (была удалена) |
| 5 | `frontend/src/hooks/useAuth.ts` | `waitForTelegram` exhaustion → error state вместо слепого `authenticate()` с пустым initData |
| 6 | `frontend/src/App.tsx` + `useAuth.ts` | `accessRevoked` в localStorage блокировал re-auth → guard `&& !isLoading`, clear flag перед auth |
| 7 | `backend/schedulers/promo_lifecycle.py` | `warn_expiring(bot=None)` → early return с warning log |

### Коммит
- `006b0da` — fix: resolve 3 blockers + 7 warnings from code review

---

## ✅ Выполнено в сессии 7 (2026-04-16) — Automated Code Review Setup

### Что сделано
- Создан `.claude/commands/review-pr.md` — slash-команда `/review-pr` для Claude Code CLI
- Промпт написан на основе реального кода репозитория (не шаблон)
- Покрывает: security.py (HMAC), deps.py (TTL), shop.py (race condition), promo.py (race condition), schedulers (cascade order), FSM contract, Telegram SDK специфика
- 8 блокеров (🚫 BLOCK) + 10 предупреждений (⚠️ WARN)
- Настроен под workflow без PR: анализирует `git log/diff --since="72 hours ago"`
- Claude Code CLI установлен: `npm install -g @anthropic-ai/claude-code`
- GitHub подключён через `/web-setup` на `claude.ai/code`

### Как использовать
```bash
cd ~/Projects/Workout-Bot-FSM
claude --dangerously-skip-permissions
/review-pr        # последние 72 часа
/review-pr 24     # последние 24 часа
```

### Почему не Routine
- Routine требует PR (ветки) для GitHub-триггера
- Разработчик пушит напрямую в main без веток
- `/review-pr` вручную — оптимальный вариант для solo workflow

---

## ✅ Выполнено в сессии 6 (2026-04-15) — Вариант Б: мини-апп самостоятельная регистрация

### Проблема
Незарегистрированный пользователь открывал мини-апп → 403 NO_ACCESS → `accessRevoked=true` → мёртвый экран. Регистрация требовала бота.

### Решение
- **`backend/api/routers/auth.py`**: `POST /auth/register` — если юзер не в БД → создаёт минимальную запись (role='player' в БД, JWT role='new'), если уже есть → возвращает как `/telegram`
- **`backend/core/deps.py`**: role='new' и player с `onboarding_done=False` → пропускают TTL-check → могут вызвать `/promo/activate`
- **`frontend/src/api/client.ts`**: 403 NO_ACCESS больше не ставит `accessRevoked`, пробрасывается в useAuth
- **`frontend/src/hooks/useAuth.ts`**: при 403 NO_ACCESS → авто-вызов `/auth/register` → JWT role='new'
- **`frontend/src/stores/authStore.ts`**: добавлен тип `'new'` в `LegacyRole`
- **`frontend/src/App.tsx`**: `role='new'` → OnboardingFlow показывается без фото

### Итоговый флоу (новый пользователь)
1. Открывает мини-апп → `/auth/telegram` → 403 NO_ACCESS
2. Авто-вызов `/auth/register` → создаёт запись → JWT role='new'
3. `OnboardingFlow` показывается (promo step)
4. Вводит промокод → становится admin/responsible/player
5. Фото (PhotoGate) → готово

### Попутные фиксы (сессия 6)
- `promo.py` ADMIN_PROMO_CODE: `has_player_access=False` (не игрок до приглашения)
- `onboarding.py` bot: `has_player_access=False` при создании admin
- `auth.py` admin/responsible: `effective_onboarding_done=True` (пропуск OnboardingFlow для существующих)

---

## ⚠️ ОТКРЫТЫЕ ВОПРОСЫ (НАПОМНИТЬ ПОЛЬЗОВАТЕЛЮ В НАЧАЛЕ СЕССИИ)

1. **Архитектура Админа** — ЧАСТИЧНО РЕШЕНА (device switching fix применён). Полная архитектура (NULL partnership как Игрок) — ОТЛОЖЕНА.
> "Решаем вопрос полной архитектуры Админа сейчас или попозже?"

2. **Глобальная переработка Маркета** — ОТЛОЖЕНА. Решить перед тренировочным интерфейсом.
> "Прорабатываем глобальную логику Маркета сейчас или попозже?"

Контекст Маркета (для будущей сессии):
- Игрок покупает только за **звёзды** (которые набирает за тренировки)
- Ответственный покупает за **очки Ответственного** (TBD) ИЛИ за **реальные Telegram Stars**
- В магазине: **нативные лоты от приложения** + **лоты от Ответственного**
- Сейчас только заглушка: 5 готовых лотов + 6-й "Пустой лот" (некликабельный)

---

## 🔜 Первое действие следующей сессии

**Приоритет — протестировать Вариант Б, затем тренировочный интерфейс.**

### Тест-план (сессия 6, не проверено):
1. TRUNCATE всех таблиц
2. Открыть мини-апп без бота → должен появиться OnboardingFlow (promo screen)
3. Ввести ADMIN_PROMO_CODE → стать Admin → PhotoGate → главное меню (4 куба)
4. Убедиться: `has_player_access=false` в БД для admin
5. Тест-аккаунт открывает мини-апп → OnboardingFlow → вводит player-код из ActionCube Admin → становится **игроком** (не Responsible!)
6. Тест-аккаунт создаёт Responsible-код (если нужно) → Admin вводит → `has_player_access=true`

### Если тест провалится:
- Смотреть Railway logs: `/auth/register` endpoint
- Проверить: нет ли CHECK constraint ошибок при INSERT в `users`
- `role` колонка — дефолт 'player', НЕ вставляем 'new' в БД



Перед стартом рекомендуется тестовый прогон (если ещё не делался):
- `/start` → промокод Responsible → мини-апп → ActionCube (чип с кодом справа вверху)
- Dashboard: реальные цифры, смена P/R
- TTL: `/new_promo` → 7 дней → Игрок активирует → чип с датой истечения
- Деактивация: `UPDATE promo_codes SET expires_at = now() - INTERVAL '1 minute'` → Job A → 403 PROMO_EXPIRED → AccessRevokedScreen

---

## ✅ Выполнено в сессии 4 (2026-04-15) — Avatar Preload + Theme Crossfade

### Проблема
Аватар появлялся медленно при каждом открытии мини-аппа. При смене темы тёмный/светлый аватар "ехал со стороны" вместо плавного растворения.

### Решение: 3 слоя

**Слой 1 — `frontend/src/stores/authStore.ts`**
- `photoUrl`, `photoDarkUrl`, `photoLightUrl` теперь инициализируются из `localStorage` (`wb_photo`, `wb_photo_dark`, `wb_photo_light`)
- `setAuth` / `setPhotoUrl` / `setStyledPhotos` сохраняют URL в localStorage
- `clearAuth` удаляет все 3 ключа
- Эффект: на повторном открытии URL доступен до ответа `/auth/telegram` → браузер делает cache hit

**Слой 2 — `backend/api/routers/users.py` + `backend/requirements.txt`**
- После загрузки оригинала: Pillow создаёт thumbnail `900×1600 @ 80%` (~150KB)
- Thumbnail сохраняется в Storage как `{tid}/thumb.jpg`
- `profile_photo_url` в таблице `users` теперь указывает на **thumb** (не оригинал)
- Gemini (`process_photo_styles`) по-прежнему получает **оригинальный** `photo_bytes`
- Эффект: CDN отдаёт 150KB вместо 3–5MB при холодном кэше

**Слой 3 — `frontend/src/hooks/useAuth.ts`**
- Убран слепой `setTimeout(authenticate, 100)`
- Заменён на `waitForTelegram(retries=5, delay=50ms)` — retry loop с проверкой готовности моста
- Эффект: быстрые устройства — 0ms задержки; медленный Android — макс 250ms вместо фиксированных 100ms

**Бонус — `frontend/src/design/backdrop/Backdrop.tsx`**
- `key` изменён с `'personal'` на `String(faceSrc)` — теперь AnimatePresence срабатывает при смене темы
- `mode="wait"` → `mode="sync"` — кроссфейд (старое и новое одновременно)
- `duration: 1.5s` + `blur(16px)` — медленное затухание/появление
- **`frontend/src/design/backdrop/Backdrop.css`**: добавлен `position: absolute` к `.face-image` — устраняет смещение в flex при одновременном рендере двух `motion.img`

### Коммиты сессии 4
- `1ba8f6d` — perf: 3-layer avatar preload — localStorage cache, server thumb, smart TG wait
- `0ee53c8` — feat(backdrop): slow crossfade on theme switch — sync mode + 1.5s blur transition
- `69408f3` — fix(backdrop): absolute position face-image to prevent flex layout shift on crossfade
- `dfceb19` — chore: update SESSION_STATUS after session 4

---

## ✅ Выполнено в сессии 3 (2026-04-15) — TTL Banner Fix + Admin Connections

### Backend
- **`backend/api/routers/promo.py`**: `GET /promo/player-status` — early return для admin/responsible (`is_active=True, days_left=None`). Фикс: Admin/Responsible в P-view видели баннер "Доступ истекает".
- **`backend/api/routers/admin.py`**: добавлен `general_router` (`prefix="/admin"`) + endpoint `GET /admin/connections` — возвращает все пары Responsible→Players с флагом `is_deactivated`.
- **`backend/main.py`**: добавлен `admin_general_router`.

### Frontend
- **`frontend/src/components/cubes/ActionCube.tsx`**: `showExpiryBanner` требует `promoStatus?.is_active === true`.
- **`frontend/src/api/admin.ts`**: типы `PlayerInPair`, `ResponsibleGroup`, `ConnectionsResponse` + `getConnections()`.
- **`frontend/src/components/cubes/AdminCube.tsx`**: `ConnectionsPanel` + кнопка-переключатель "Соединения/Промокоды".
- **`frontend/src/styles/cubes.css`**: стили `.connections-*`.

---

## ✅ Выполнено в сессии 2 (2026-04-15) — Promo List Fix + Photo Consent

### Backend
- **`backend/api/routers/admin.py`**: `GET /admin/promo/list` фильтрует `code_type='responsible'`. Фикс: player-invite коды попадали в панель Админа.

### Frontend
- **`frontend/src/components/photo-gate/PhotoGate.tsx`**: чекбокс согласия в INTRO фазе; кнопка "Открыть камеру" `disabled` пока не проставлен.
- **`frontend/src/components/photo-gate/PhotoGate.css`**: стили `.pg-consent`, `.pg-btn--primary:disabled`.

---

## ✅ Выполнено в сессии 1 (2026-04-14) — Access Hardening + TTL Lifecycle

### Ключевые изменения
- `backend/core/deps.py`: `get_current_user` проверяет живую запись в `promo_codes` с `expires_at > now()` для player → 403 `PROMO_EXPIRED`
- `backend/api/routers/auth.py`: убран upsert, только SELECT + 403 `NO_ACCESS` если юзера нет
- `backend/services/fsm/onboarding_fsm.py`: все `.maybe_single()` защищены от None
- `backend/handlers/onboarding.py`: upsert юзера только после успешной валидации промокода
- Migration 012: `duration_days`, `activated_at`, `expires_at`, `warn_sent` в `promo_codes`; таблица `promo_codes_archive`; `deactivated_at`, `scheduled_deletion_at` в `users`
- APScheduler: Job A (10 мин) — архивация + деактивация; Job B (1 час) — предупреждение; Job C (сутки) — удаление
- Frontend: 403 interceptor → `accessRevoked`; `AccessRevokedScreen`; TTL чип в ActionCube

### Коммиты
- `89e43e0` — fix: get_state maybe_single guard
- `cdc6c1b` — feat: hard black lock App.tsx
- `5cae2f7` — auth(player): gate access on live promo_codes row

---

## ✅ Что реализовано (полная картина)

### Frontend
- Vite + React + TS, 4 куба (Admin видит 4й): Action, Market, Bond, Admin
- Gesture system: hold+swipe-up → тема, tap → fullscreen, долгий hold → dashboard, swipe → карусель
- Dual-role P/R, `RoleTransition`, `DashboardRoleSwitch`, `activeRoleView` в zustand
- Темы: dark (космос) / light (туманность), плавный кроссфейд 1.5s
- Backdrop: ghost face (localStorage-кэшированный, position:absolute) + GlassCubes + Starfield/CloudField
- ActionCube, MarketCube, BondCube, AdminCube (с панелью Соединений)
- Dashboard: real-data виджеты, role-aware контент
- PhotoGate: face detection, consent checkbox, upload → server thumb
- AccessRevokedScreen, TTL баннер, деактивированные игроки

### Backend (Railway, Python 3.11 + FastAPI + Aiogram 3)
- Auth: JWT, initData validation, get_current_user с TTL-проверкой для player
- Routers: auth, users, partnerships, activity_feed, promo, admin, stats, shop, boosts
- APScheduler: 3 jobs (архивация, предупреждение, удаление)
- Photo: upload оригинала → Pillow thumb → Gemini стилизация async

### Database (Supabase PostgreSQL)
- Миграции 001–012 применены
- Таблицы: users, partnerships, subscriptions, player_stats, shop_items, purchases, boosts, activity_feed, promo_codes, promo_codes_archive
- RLS включён, service_role key на бэкенде

---

## 🔜 Что дальше (приоритет)

### 1. Тренировочный интерфейс — ✅ РЕАЛИЗОВАН в сессии 20
Осталось: миграция 017 + Storage bucket + end-to-end тест с Gemini.

### 2. Архитектура Админа (ОТЛОЖЕНО)
Обе роли без промокодов, NULL partnership как Игрок.

### 3. Глобальная переработка Маркета (ОТЛОЖЕНО)
Нативные лоты + лоты Ответственного, разные валюты.

### 4. rootMachine обновление + Unit tests для `workoutSessionMachine` reducer

---

## 🐛 Известные особенности
- `.maybe_single()` supabase-py: ВСЕГДА проверять `if res is not None` перед `.data`
- Supabase service_role key обходит RLS — всё ок
- Railway деплой: green = успешно, но может занять 1-2 мин после push
- Vercel деплой: автоматически при push в main
- `npm run build` в песочнице падает из-за rolldown native binding — на реальной машине работает
- Git push из песочницы не работает (нет auth) — пушить локально

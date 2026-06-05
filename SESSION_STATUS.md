# SESSION STATUS — Session 39 (2026-06-05) — 7.3 заблокирован: Railway trial expired + unpaid invoice

## 🚨 ИНФРА-БЛОКЕР (Session 38 → Session 39)
**Railway:** Trial Ended + Unpaid Invoice («card has insufficient funds»). Все 3 проекта `0/X services online`, включая наш `affectionate-unity / production` (Workout Bot backend). До восстановления — smoke невозможен, любой push GitHub примет, но Railway проигнорит.

**Что должен сделать юзер (вне Claude Code):**
1. В Railway → Pay Invoice (если Visa 4120 declined → привязать рабочую карту в Settings → Billing → повторить).
2. Subscribe → Hobby ($5/mo). Бот в idle ест копейки → ожидаемо $5–8/мес.
3. `affectionate-unity → production` → дождаться поднятия service или Redeploy.
4. Проверить env `GEMINI_API_KEY=...XNHY` (могло слететь после простоя).
5. Проверить Vercel frontend (`vercel.com/dashboard`) — должен быть Ready, free tier не истекает.

## 🟡 ОТКРЫТЫЙ ВОПРОС (спросить юзера в начале сессии)
1. **Railway оживили?** (Hobby оплачен, `affectionate-unity` поднят, env проверены)
2. **Vercel жив?**
3. **Запушил `git push` с мака?** (commit `f6ca824` готов в локальном `main`, sandbox-push упал без credentials)
4. **Smoke прогнан** на TG `8777447186` (Cell, 3+ настоящих упражнения)?

## ▶️ План Session 39 (как только все ответы = да)
1. SQL-чек последней сессии: `started_at` ≥ деплою; `drops_earned` сходится с прикидкой ниже.
2. Финальная карточка показывает «XP {avg}» + **«Капли 💧 {drops}»** (НЕ «Звёзды ⭐»).
3. Если ОК → 7.3 → **CLOSED**, открыть **7.4 (Telegram Stars payments через test_dc)**.

## 🔒 Codex-аудит Session 38 (репо приватный → не блокер, но в TODO)
- ⚠️ **Утечка Gemini key** в `research/compare_quality.py:6` и в git history (`PROMPT_AI_PHOTO.md`, старые `SESSION_STATUS.md`). Репо приватный → не критично, но при первом расшаривании ротировать + `git filter-repo`.
- ⚠️ Webhook логирует ожидаемый секрет при mismatch — `backend/main.py:133`. Фикс одной строкой, отложен.
- ⚠️ `validate_init_data` не проверяет `auth_date` freshness — `backend/core/security.py:22`. Replay-window. Отложен.
- ⚠️ `AdminCube.tsx:219` — pre-existing `total_stars_earned` typo (бэк отдаёт `total_xp_earned`). Отложен.
- ⚠️ `/boosts/buy` активирует буст без оплаты — `backend/api/routers/boosts.py:79`. Гейтится в 7.4 вместе со Stars.
- ⚠️ `finish_session` не обновляет `global_score/three_day_score`; админ-стата врёт. Отложено в Phase 8.
- ⚠️ Видео-ретеншн 7 дней — только комментарий в миграции. Отложено в Phase 8 (GDPR).
- ⚠️ FE FSM reducer принимает поздний `AI_VERDICT` в любом состоянии — `frontend/src/fsm/workoutSessionMachine.ts:73`. БД корректна (upload использует captured `exercise_idx`), но локальный FSM может дрейфить. Отложено.

Все эти пункты добавлены в `BACKLOG.md` секцию «Codex audit · Session 38», читать перед Phase 8.

## 📌 Ожидаемые цифры smoke (по новой формуле)
- 3@100, streak=0: quality=1.0, completion=(3/16)^0.65≈0.3369 → raw≈16.84 → **drops=17**
- 8@80, streak=5: → **drops=27**
- 16@100, streak=0: cap → **50**
- 16@100, streak=20: raw=65 → cap → **50**
- 0 упражнений: **0**

## 🔑 Ключи / окружение
- Supabase: `dlpdwmmfpzfxcelxqvlq` (миграция 026 применена).
- Gemini: `...XNHY` (project `workout-bot`).
- Test Player: TG `8777447186` (Cell, standard, спарен с Oil `8580720783`).
- Local commit ожидающий push: `f6ca824` — `feat(7.3): Stars→Drops rename + new drops formula`.

---

# SESSION STATUS — Session 37 (2026-05-07) — 7.3 = Drops rename + новая формула ✅

## ✅ Сделано в Session 37
- **Миграция 026** (`backend/db/migrations/026_rename_stars_to_drops.sql`) создана и **применена через Supabase MCP** (project `dlpdwmmfpzfxcelxqvlq`). Колонка `workout_sessions.stars_earned → drops_earned`.
  - Verified: `SELECT column_name FROM information_schema.columns WHERE table_name='workout_sessions' AND column_name IN ('stars_earned','drops_earned')` → `[{"column_name":"drops_earned"}]`.
  - Старые данные сохранены: последняя сессия от Session 36 (`2026-05-04`, total_score=315, drops_earned=10) — корректно перенесена.
- **`backend/core/workout_config.py`** — `MAX_STARS_PER_SESSION → MAX_DROPS_PER_SESSION`, докстринг с новой формулой.
- **`backend/api/routers/workout.py`** — импорт + `WorkoutConfigResponse.max_drops_per_session` + `FinishSessionResponse.drops_earned`. В `finish_session` теперь читаем `current_streak` ДО расчёта (нужен для `streak_mult`), новая формула:
  ```
  done_scores = [s for s in scores if s > 0]
  quality     = sum(done_scores)/len/100
  completion  = (done/16)**0.65
  streak_mult = 1 + min(streak,20)*0.015     # cap +30%
  drops       = round(min(50*quality*completion*streak_mult, 50))
  avg_score   = round(quality*100)
  ```
  `xp_balance += drops` (in-game currency = drops).
- **`frontend/src/api/workout.ts`** — `max_drops_per_session`, `drops_earned`.
- **`frontend/src/components/workout/WorkoutScreen.tsx`** — финальная карточка: `Звёзды ⭐ {stars_earned}` → `Капли 💧 {drops_earned}`.

## ⚠️ Не трогали (outside scope 7.3)
- `AdminCube.tsx:219` — pre-existing typo `g.stats.total_stars_earned` (бэкенд отдаёт `total_xp_earned`, поле рендерится `undefined`). Не относится ни к Drops, ни к фазе 7.3 — оставить как tech-debt.
- Light-режим, дисклеймер-тесты, экономика → фаза 8.
- `017_workout_sessions.sql` исторический — не правим, миграция 026 переименовала поверх.

## ▶️ Что делать в Session 38
1. Убедиться что push прошёл и Railway/Vercel задеплоились (~2 мин).
2. Юзер прогоняет smoke на TG `8777447186` (Cell). Делает 3+ упражнения по-настоящему (приседания/отжимания/планка).
3. Проверка финальной карточки: «XP {avg}» + **«Капли 💧 {drops}»** (НЕ «Звёзды ⭐»). drops > 0.
4. SQL-чек:
   ```sql
   SELECT id, status, total_score, drops_earned, started_at
   FROM workout_sessions
   WHERE player_id = (SELECT id FROM users WHERE telegram_id = 8777447186)
   ORDER BY started_at DESC LIMIT 1;
   ```
   `started_at` ≥ дате деплоя (не `2026-05-04` от Session 36).
5. Если ОК → 7.3 → **CLOSED**, переход в **7.4 (Telegram Stars payments через test_dc)**.

## ⚠️ Известные tech-debt (вне 7.3)
- `frontend/src/components/cubes/AdminCube.tsx:219` — `g.stats.total_stars_earned` рендерится `undefined` (бэкенд отдаёт `total_xp_earned`). Pre-existing typo, не блокер. Отдельной строкой в BACKLOG не добавляли — фиксится в один грэп.
- `017_workout_sessions.sql` всё ещё содержит исходное `stars_earned` (история). Миграция 026 переименовала поверх — оставить как есть, новые миграции пишутся как diff.

## 📌 Ожидаемые цифры (sanity-check на старте Session 38)
- 3 упражнения по 100, streak=0:
  - quality=1.0; completion=(3/16)^0.65 ≈ 0.3369; streak_mult=1.0
  - raw = 50 × 1.0 × 0.3369 × 1.0 ≈ 16.84 → drops = **17**
- 16 упражнений по 100, streak=0: drops = **50** (cap).
- 16 по 100, streak=20: raw=65 → cap → **50**.
- 0 упражнений: drops = **0**.

## 🔑 Ключи / окружение
- Supabase: `dlpdwmmfpzfxcelxqvlq` (миграция 026 применена).
- Gemini: `...XNHY` (project `workout-bot`).
- Test Player: TG `8777447186` (Cell, standard, спарен с Oil `8580720783`).

---

# SESSION STATUS — Session 36 (2026-05-04) — 7.3 в процессе закрытия + design фазы 8

## ✅ Что разблокировалось в Session 36
- Gemini API заработал (новый ключ `...XNHY`, проект `workout-bot`, prepay пополнен).
- Юзер прогнал смоук-сессию: 3 упражнения по ~100 → формула выдала **XP 20, Stars 10**.
- Подтверждено: `ai_score` записывается, формула работает.

## 📐 Что было сделано в Session 36 (без кода)
- **Полное design-интервью** по новой формуле капель + механика типов тренировок (main/light) + экономика покупок + privacy/safety policy.
- Все решения оформлены в **`BACKLOG.md` → секция «🟦 Фаза 8 — Workout Types & Drops Economy (DESIGN DOC)»**.
- Согласованы все принципы: pair-only, без расторжения, hidden streak-multiplier, GDPR-policy на видео, etc.

## 🟡 ОТКРЫТЫЙ ВОПРОС / задача для Session 37

**Закрыть 7.3:** переименовать `Stars → Drops (Капли 💧)` + применить новую формулу.

### ⚠️ Перед началом Session 37
**ОБЯЗАТЕЛЬНО прочитай `BACKLOG.md` секцию «Фаза 8»** — там весь контекст design-doc'а из Session 36.

### Новая формула (финал, для имплементации):
```python
# В backend/api/routers/workout.py, замена логики на 251-255:
done_scores = [s for s in scores if s > 0]
done_count  = len(done_scores)
quality     = (sum(done_scores) / done_count / 100.0) if done_count > 0 else 0.0
completion  = (done_count / 16) ** 0.65 if done_count > 0 else 0.0
streak_mult = 1 + min(current_streak, 20) * 0.015   # cap +30%
raw         = 50 * quality * completion * streak_mult
drops       = round(min(raw, 50))
```

### Файлы для правки в Session 37:
| Файл | Что делать |
|---|---|
| `backend/db/migrations/026_rename_stars_to_drops.sql` | Создать. ALTER TABLE: `stars_earned → drops_earned`, `stars_awarded → drops_awarded` |
| `backend/api/routers/workout.py:251-255` | Новая формула + переименование переменных |
| `backend/models/workout.py` (или где `FinishSessionResponse`) | Поля `stars_earned → drops_earned` |
| `frontend/src/components/workout/WorkoutScreen.tsx` | UI: «Звёзды» → «Капли 💧» |
| `frontend/src/api/workout.ts` (типы) | `stars_earned → drops_earned` |

### План на Session 37 (порядок):
1. Прочитать `BACKLOG.md` секцию «Фаза 8» — там весь контекст.
2. Применить миграцию `026_rename_stars_to_drops.sql` через Supabase MCP.
3. Обновить backend (formula + переименование переменных).
4. Обновить frontend (UI + типы).
5. Деплой → юзер прогоняет смоук → проверка drops > 0 в финальной карточке.
6. Если ОК → 7.3 → **CLOSED**, переход к **7.4 (Telegram Stars payments через test_dc)**.

### Принципиальное (для Session 37 учесть):
- Это **закрывает только 7.3** — base-case: 16 main-упражнений, без light-режима.
- Light-режим, экономика, дисклеймер-тесты, decay, snooze, two-mode shop — это всё **фаза 8**, отдельно.
- В Session 37 трогаем **только формулу + переименование**.

### 🔑 Ключи / окружение
- Gemini ключ: `...XNHY` (проект `workout-bot`) — работает после пополнения prepay.
- Supabase project: `dlpdwmmfpzfxcelxqvlq`
- Тестовый аккаунт Player: TG `8777447186` (Cell, standard, спарен с Oil `8580720783`).

---

# SESSION STATUS — Session 35 (2026-05-03) — Задача 7.3 🚧 BLOCKED (Gemini API)

## 🚧 Задача 7.3: E2E Smoke Test — БЛОКЕР: Gemini billing

### ⚠️ ОТКРЫТЫЙ ВОПРОС (спроси юзера в начале новой сессии)
**Заработал ли Gemini API после смены ключа и оплаты overdue?**
- Юзер должен был: оплатить $8.39 overdue в Google AI Studio Billing, обновить `GEMINI_API_KEY` в Railway env на новый ключ `...XNHY` (проект `workout-bot`, gen-lang-client-0531472359).
- Проверка: запросить у юзера скрин `aistudio.google.com/api-keys` — статус ключа должен быть `Available · Prepay/Postpay`, НЕ `Unavailable`.
- Если `Available` → можно делать финальный smoke и закрыть 7.3.
- Если ещё `Unavailable` → ждать или искать workaround (новый Google аккаунт + новый key).

### ✅ Сделано в Session 35
**WorkoutScreen — много багфиксов и фич (~15 коммитов):**
- BUG-3 (камера/демо во время rest) — FIXED. На rest stop tracks камеры, демо unmount.
- BUG-4 (sync таймера при сворачивании) — FIXED. Wall-clock timer + visibility reconciliation.
- BUG-5 (закрытие/свайпы Telegram) — частично решено: fullscreen + closing confirmation + BackButton intercept + edge-swipe touchInterceptor. Полностью отключить горизонтальный pager-свайп iOS Telegram **технически невозможно** (research-вердикт: нет такого API в Bot API 9.0). Закрыто **дисклеймером** перед стартом тренировки.
- Layout: split 60% камера сверху + 40% демо снизу, через CSS Grid (`grid-template-rows: 6fr 4fr`).
- **Portal rendering**: WorkoutScreen рендерится через `createPortal(..., document.body)` — обходит containing-block trap от `motion.div + backdrop-filter` родителей в `App.tsx → ActionCube`.
- Safe-area-insets для iPhone status bar / Dynamic Island.
- Сегментированный progress bar (16 сегментов с exercise+rest sub-fill, плавная заливка, цвет по фазе).
- Topbar: убран `×`, заменён на «Завершить» с confirm.
- Переименование «Score» → «XP» в финальной карточке.
- Камера constraints: `1920×1080 landscape` для широкого FOV; `object-fit: cover`.
- Демо: `object-fit: contain` (показывает весь фрейм, чёрные полосы по бокам если AR не совпадает).
- **Word-by-word announcement на rest** — вместо статичной карточки: большие слова по очереди («Сейчас» → «будет» → name → «Положение:» → position → «Работают:» → muscles[] → hint).
- **Дисклеймер модал** перед стартом — предупреждает про свайпы.
- **Early camera init** в rest-фазе (за 5 сек до конца) → плавный переход в prepare без задержки.
- **Demo preload** — скрытый `<video>` следующего упражнения во время rest.
- HUD compact (countdown 44px, badge 11px), не клиппится.

### 🐛 Найдено + диагностировано (НЕ пофикшено — блокер):
**Все 16 упражнений последней сессии = ai_score 0, feedback="AI не смог проанализировать".**
- Логи Railway: `WARNING:backend.services.workout_vision:Gemini gemini-2.5-flash failed: 403 PERMISSION_DENIED. {'error': {'code': 403, 'message': 'Your project has been denied access. Please contact support.', 'status': 'PERMISSION_DENIED'}}` — то же для fallback `gemini-2.0-flash`.
- Корневая причина: Google AI Studio billing — **карта Visa 4120 declined, $8.39 overdue**. Project denied access до оплаты.
- Юзер: создал новый проект `workout-bot` (gen-lang-client-0531472359) с ключом `...XNHY`, нажал «Pay now» в Billing.
- TODO: после подтверждения оплаты — обновить `GEMINI_API_KEY` в Railway env, передеплой, прогон 3 настоящих упражнений → проверить XP > 0 и Stars > 0.

### 📊 Формула XP/Stars (для справки, `backend/api/routers/workout.py:251-255`)
```python
TOTAL_EXERCISES = 16
MAX_STARS_PER_SESSION = 50
scores = [int(r.get("ai_score") or 0) for r in (ex_res.data or [])]
total = sum(scores)
avg = round(total / TOTAL_EXERCISES)         # делим на ВСЕ 16 (даже если часть = 0)
stars = round(avg * MAX_STARS_PER_SESSION / 100)
```

**Пример:** 3 упражнения по 70 очков, 13 не сделано → avg = round(210/16) = 13, stars = round(13*50/100) = 6.
Партиал-сессии штрафуются. Юзер ОК с этим? Или менять формулу (делить на submitted, не на 16)?
**TODO в новой сессии:** обсудить после первой реальной XP > 0 сессии.

### 🗒️ Заметки про БД и SQL
- Таблица упражнений сессии называется **`workout_exercises`**, НЕ `workout_clips` (в моих SQL-чеках в старых сессиях была опечатка — поправить если будут writeup'ы).
- Корректный SQL для проверки скоров последней сессии Cell:
```sql
SELECT exercise_idx, ai_score, feedback, created_at
FROM workout_exercises
WHERE session_id = (
  SELECT id FROM workout_sessions
  WHERE player_id = (SELECT id FROM users WHERE telegram_id = 8777447186)
  ORDER BY started_at DESC LIMIT 1
)
ORDER BY exercise_idx;
```

### ▶️ Что делать в Session 36
1. **СПРОСИТЬ ЮЗЕРА**: оплатил overdue? Обновил Railway env? Статус ключа в AI Studio?
2. Если ОК → попросить прогнать 3 упражнения по-настоящему (приседания / отжимания / планка) → проверить ai_score > 0 в `workout_exercises`.
3. Если XP > 0 в финале → 7.3 → **CLOSED**.
4. Перейти в **7.4: Telegram Stars payments** (см. `PLAN.md` / `ROADMAP.md`).
5. Заглянуть в `BACKLOG.md` — там лежат:
   - Naming convention для демо-видео (для будущих кастомных демо юзера)
   - Recovery сессии при случайном свайпе

### 🔑 Ключи / окружение
- Старый ключ Gemini: `...FNA8` (проект `Default Gemini Project`, gen-lang-client-0677974339) — заблокирован
- Новый ключ Gemini: `...XNHY` (проект `workout-bot`, gen-lang-client-0531472359) — нужно обновить в Railway env
- Supabase project: `dlpdwmmfpzfxcelxqvlq`
- Тестовый аккаунт Player: TG `8777447186` (Cell, standard, спарен с Oil `8580720783`)

---

# SESSION STATUS — Session 34 (2026-04-30) — Задача 7.3 🔄 IN PROGRESS

## 🔄 Задача 7.3: E2E Smoke Test (Standard Tier) — продолжение

### Аккаунты для теста (БД `dlpdwmmfpzfxcelxqvlq`)
| TG ID | Имя | Роль | Tier |
|---|---|---|---|
| 8580720783 | Oil | Responsible | standard |
| 8777447186 | Cell | Player (у Oil) | standard |

### ✅ Пройдено в этой сессии (Session 34)

**BUG-1 (layout) — FIXED ✅**
- `frontend/src/components/workout/WorkoutScreen.tsx`: переписан JSX — основной фон стал `<video class="ws-demo-video">` (демо упражнения, autoplay+loop), камера юзера переехала в `<video class="ws-cam-pip">` (top-right, 28vw, mirrored). Название упражнения вынесено в `.ws-name-overlay` снизу.
- `frontend/src/components/workout/WorkoutScreen.css`: добавлены `.ws-demo-video`, `.ws-cam-pip`, `.ws-name-overlay`. HUD перенесён в bottom-left, countdown уменьшен.
- Демо-видео НЕ `muted` — звук разблокируется при тапе «Начать» (user gesture).

**BUG-2 (попап между упражнениями) — FIXED ✅**
- Удалён center-card для `aiVerdictReview`. Добавлен `useEffect` с автопереходом: после `aiVerdictReview` через `Math.max(800, review_sec*1000)` авто-шлёт `NEXT_EXERCISE`. Поток непрерывный.

**16 демо-видео нарезаны и закоммичены ✅**
- 16 mp4 файлов в `frontend/public/demos/<key>.mp4` (h264, 720×1280, 8.0 сек, ~25 МБ суммарно).
- Источник: 3 длинных тренировки в `_workout_sources/{1,2,3}.mp4`. Antigravity-агент (Gemini 3.1 Pro) собрал спрайты через PIL и нашёл таймкоды; финальную нарезку сделал Cowork (ffmpeg в sandbox).
- ⚠️ **Content debt:** многие клипы НЕ совпадают с названием упражнения (Gemini местами ошибся). Для smoke-теста достаточно — контент заменим перед продакшеном.
- Source video 3.mp4 не использован (агент нашёл всё в 1.mp4 + 2.mp4).

**Конфиг циклa изменён ✅** (`backend/core/workout_config.py`)
- `EXERCISE_SEC`: 40 → **60** (1 минута активной работы)
- `REST_SEC`: 90 → **30** (30 сек отдыха)
- Итого цикл: 16 × (5+60+30+5) = **~26.7 мин** (было 37.3)
- Frontend пикапит автоматически через `GET /workout/config`.
- ⚠️ 30 сек rest — тайтко для Gemini Vision на 60-сек клип. Если в smoke-тесте будут частые `errorMessage` в `aiVerdictReview` — поднять `REST_SEC` до 45 или 60.

### 🆕 Артефакты сессии (можно удалить после прохождения smoke)
- `_workout_sources/{1,2,3}.mp4` — длинные исходники (~950 МБ, в `.gitignore` уже / или добавить)
- `WORKOUT_VEO_PROMPTS.md` — 16 промптов для Veo 3 (на случай смены источника)
- `STOCK_VIDEO_SEARCH.md` — ссылки на Pexels/Mixkit/Pixabay по упражнениям
- `YOUTUBE_CUT_PLAN.md` — гайд по нарезке из YouTube
- `ANTIGRAVITY_CUT_PROMPT.md` — промпт для Antigravity (использовался)

### 📦 Коммиты, которые ждут push
1. `7642e90` — feat(workout): add 16 demo videos + enable audio on demo player
2. `(не закоммичен из-за git lock)` — config(workout): exercise 40s→60s, rest 90s→30s
   - Файл изменён, изменения staged. Юзеру дома: `rm -f .git/HEAD.lock && git commit -m "config(workout): exercise 40s→60s, rest 90s→30s" && git push`

### ▶️ Что делать в следующей сессии (Session 35)

**Сначала** — пользователь дома пушит зависший коммит конфига (см. выше) и ждёт деплой Railway/Vercel (~2 мин).

**Потом** — Phase 2 step 2.6+ (`TASK_7_3_SMOKE_PLAN.md`, секция "Phase 2 — Workout Session"):
1. **2.6:** Открыть Mini App с TG #2 (Cell, `8777447186`) → запустить тренировку → проверить что:
   - На фоне крутится демо-видео (со звуком из видео или тишиной — у нас `-an`)
   - Камера в углу (PiP)
   - Название упражнения снизу
   - Между упражнениями НЕТ попапа
   - В Network/Railway: `POST /workout/clip` → 200 + `{exercise_idx, score, feedback}`
2. **2.7:** Свернуть Telegram на 30 сек → таймер не замёрз
3. **2.8:** Дать сессии завершиться → score + Stars
4. **Phase 3:** Shop & Boosts (`MarketCube` → купить boost)
5. **Phase 4:** Edge cases (Dol legacy guard `forcashe`, tier-limit у Oil)

После полного прогона — обновить SESSION_STATUS.md (Session 35), задача 7.3 → **CLOSED**, переход в **7.4 (Telegram Stars payments)**.

### 📋 SQL-чеки после Phase 2 (для следующей сессии)
```sql
-- Сессия завершена?
SELECT id, status, started_at, ended_at, score, stars_awarded
FROM workout_sessions
WHERE player_id = (SELECT id FROM users WHERE telegram_id = 8777447186)
ORDER BY started_at DESC LIMIT 1;

-- 16 клипов залились?
SELECT count(*) FROM workout_clips WHERE session_id = '<SESSION_ID>';

-- Stats обновились?
SELECT global_score, xp_balance, current_streak, last_workout_date
FROM player_stats
WHERE player_id = (SELECT id FROM users WHERE telegram_id = 8777447186);
```

### 🤔 Открытые вопросы (НЕ блокеры smoke-теста)
- **Content correctness:** заменить демо-видео на правильно подписанные (Veo / Pexels / своя съёмка) перед продакшеном.
- **REST_SEC=30 vs Gemini latency:** проверить эмпирически на smoke; при ошибках — поднять.
- **SESSION_23_PLAN.md** (subscription/renewal архитектура) — статус не проверен в этой сессии. Это отдельная задача, не часть 7.3. Открыть и сверить с продом отдельной сессией.

---

# SESSION STATUS — Session 33 (2026-04-28) — Задача 7.3 (старт)

## 🔄 Задача 7.3: E2E Smoke Test (Standard Tier) — start

### Новые аккаунты в БД
| TG ID | Имя | Роль | Tier |
|---|---|---|---|
| 8580720783 | Oil | Responsible | standard |
| 8777447186 | Cell | Player (у Oil) | standard |

### ✅ Пройдено в Session 33
- Phase 0 (0.1–0.3): R-код standard создан, Oil зарегистрирован, P-код создан
- Phase 1 (1.1–1.7): Cell зарегистрирован, онбординг пройден, Mini App открылся
- Phase 2 (2.1–2.5): Workout запустился, WakeLock держит экран 5+ мин ✅

### 🐛 Баги найдены (фиксы → Session 34)
- **BUG-1:** Workout screen layout — нужно демо-видео на фоне, камера в PiP. ✅ Fixed in Session 34.
- **BUG-2:** Попап между упражнениями — нужен непрерывный поток. ✅ Fixed in Session 34.

---

# SESSION STATUS — Session 32 (2026-04-27) — Задача 7.2 ✅ IMPLEMENTED

## ✅ Задача 7.2: Технический долг (2026-04-27)

### 4a) Drop `users.access_tier`
- Создана миграция `backend/db/migrations/025_drop_legacy_access_tier.sql` (`ALTER TABLE users DROP COLUMN IF EXISTS access_tier`).
- Grep-аудит: ни одного runtime SELECT/UPDATE на `users.access_tier` не осталось — все ссылки или на `promo_codes.access_tier`, или на `responsible_access_tier`/`player_access_tier`, или локальные Python-переменные.
- **TODO для пользователя:** применить миграцию через Supabase MCP (project `dlpdwmmfpzfxcelxqvlq`).

### 4b) `_hidden_docs/` cleanup
- 7 файлов перемещены в `_archive/_hidden_docs/`: `INTRODUCTION.html`, `PROMPT_MINIMAL_TRANSITIONS.md`, `TEST_PLAN.md`, `code dlya workout.html`, `code_audit_report.pdf`, `promocode generate.html`, `tsc_errors.txt` (мёртвые one-shot артефакты от сессий 1–18).
- Пустая директория `_hidden_docs/` осталась — rmdir заблокирован на уровне mount; пользователь может удалить вручную.

### 4c) Ruff-волна (F401 / F841)
- `backend/api/routers/admin.py` — удалён `import secrets as _sec` (line 827, не использовался).
- `backend/api/routers/boosts.py` — удалён `status` из `from fastapi import …`.
- `backend/api/routers/promo.py` — удалён `status`.
- `backend/api/routers/stats.py` — удалён `status`.
- `backend/api/routers/workout.py` — удалён `status`.
- `backend/handlers/onboarding.py` — удалена unused `mini_app_url = …` (line 229).
- `backend/handlers/onboarding.py` — удалена unused `responsible_name = …` (line 682).
- `backend/services/fsm_mock.py` — удалён `import json`.
- `ruff check backend --select F401,F811,F841` → **All checks passed!**

### Verify
- `python3 -m py_compile` по всему `backend/` → exit 0
- `npx tsc --noEmit` → exit 0

### Файлы изменены
| Файл | Что |
|------|-----|
| `backend/db/migrations/025_drop_legacy_access_tier.sql` | NEW |
| `backend/api/routers/admin.py` | unused `import secrets as _sec` |
| `backend/api/routers/boosts.py` | unused `status` |
| `backend/api/routers/promo.py` | unused `status` |
| `backend/api/routers/stats.py` | unused `status` |
| `backend/api/routers/workout.py` | unused `status` |
| `backend/handlers/onboarding.py` | 2× unused locals |
| `backend/services/fsm_mock.py` | unused `import json` |
| `_hidden_docs/*` → `_archive/_hidden_docs/*` | 7 файлов |

### Коммиты (рекомендуемые)
- `chore(db): migration 025 — drop legacy users.access_tier`
- `chore(backend): ruff F401/F841 cleanup`
- `chore(repo): archive _hidden_docs`

## ▶️ Следующая точка входа (новый чат)

**Задача 7.3 — E2E smoke на реальном устройстве** (Sonnet + medium effort).
Также не забыть применить миграцию 025 через Supabase MCP.

---

# SESSION STATUS — Session 31 (2026-04-27) — Задача 7.1 ✅ IMPLEMENTED

## ✅ Задача 7.1: Tier Downgrade Flow с Эвикцией Игроков (2026-04-27)

### Что сделано
- **Backend endpoint**: `POST /admin/promo/apply-tier-change-with-evictions` в `backend/api/routers/admin.py`
  - Pydantic: `TierChangeEvictionReq` + `TierChangeEvictionResp`
  - Валидация: R-код не использован, тип `responsible`, caller — Responsible/Admin
  - Валидация: `current_count - evicted_count <= new_tier.max_players` (иначе 400 `INSUFFICIENT_EVICTIONS`)
  - Валидация: каждый evicted player_id принадлежит partnerships Responsible (иначе 400)
  - Каскадное удаление: hard-delete partnership → если нет других партнёрств и нет dual-role → delete player_stats / shop_items / boosts / workout_sessions
  - Обновление `responsible_access_tier` в users
  - Сжигание R-кода (is_used=True) атомарно
  - Регенерация P-кода с новым тир-префиксом
- **Bot upgrade flow**: `backend/handlers/onboarding.py` — в resp_promo обработчике добавлено обнаружение downgrade перед upsert
  - Если `has_responsible_access=True` И `count(partnerships) > new_tier.max` → бот шлёт сообщение с inline-кнопкой → Mini App deep-link `?startapp=downgrade_{tier}_{code}`
  - R-код НЕ сжигается — применяется только через новый endpoint
- **Frontend модалка**: `frontend/src/components/cubes/TierDowngradeModal.tsx`
  - Props: `targetTier, promoCode, onClose, onSuccess`
  - Чек-боксы по списку `getMyPlayers()`, Apply disabled пока `selected.size < mustEvict`
  - POST на новый endpoint → haptic success + `window.location.reload()` для обновления `own_access_tier`
- **App.tsx**: читает `start_param` из Telegram WebApp initDataUnsafe при монтировании
  - Парсит `downgrade_{tier}_{code}` → открывает `TierDowngradeModal`
- **TokenResponse** (`own_access_tier`): уже корректно отдаётся из `responsible_access_tier` — изменений не потребовалось
- **Миграция**: не нужна, все таблицы уже существуют

### Файлы изменены
| Файл | Что |
|------|-----|
| `backend/api/routers/admin.py` | `import uuid`, `TierChangeEvictionReq/Resp`, endpoint `/apply-tier-change-with-evictions`, `_TIER_PLAYER_LIMITS` |
| `backend/handlers/onboarding.py` | Downgrade detection блок в resp_promo ветке |
| `frontend/src/api/admin.ts` | `applyTierChangeWithEvictions()`, `TierChangeEvictionRequest/Response` |
| `frontend/src/components/cubes/TierDowngradeModal.tsx` | Новый файл — модалка с чек-боксами |
| `frontend/src/App.tsx` | `useEffect` для start_param, `downgradeModal` state, `TierDowngradeModal` рендер |

### Тиры (актуальные в коде)
`standard=1, premium=2, elite=3` (TIER_PLAYER_LIMITS в promo.py и admin.py)

### Acceptance тесты
Требуют выполнения на реальном боте + Supabase MCP:
1. Elite(5 игроков) → ввести P-код Premium → бот → deep-link → модалка → выбрать 3 → применить
2. Premium(1 игрок) → Standard → без модалки, сразу меняет тир
3. Попытка с недостаточным числом выбранных → 400 INSUFFICIENT_EVICTIONS
4. Dual-role игрок: partnerships удаляется, user row остаётся (has_responsible_access=True)
5. tsc + py_compile ✅ зелёные

### Коммиты (рекомендуемые)
- `feat(backend): POST /admin/promo/apply-tier-change-with-evictions`
- `feat(bot): downgrade detection in /upgrade resp_promo flow`
- `feat(frontend): TierDowngradeModal + App.tsx deep-link integration`

## ▶️ Следующая точка входа (новый чат)

**Задача 7.2 — Технический долг:**
- 4a) Drop `users.access_tier` — миграция 025_drop_legacy_access_tier.sql + grep-аудит + применить через Supabase MCP
- 4b) `_hidden_docs/` cleanup — прочитать и удалить/переместить мёртвое
- 4c) Лёгкая ruff-волна — dead imports, unused functions
- **Модель:** Sonnet + medium effort

---

# SESSION STATUS — Session 30 (2026-04-25) — Этап 6 Задача 5 ✅ COMMITTED

## ✅ Задача 5: Онбординг в боте (2026-04-25)

Расширенный онбординг для Player: после `SET_GENDER` добавлена цепочка
`player_fitness_setup → player_age_setup → player_goal_setup → Mini App`.
Команда `/settings` перезапускает цепочку с `player_fitness_setup`
(gender не трогает). Повторный триггер — Job H каждые 120 активных дней.

Коммиты:
- `319aa1e` — feat(db): migration 024 — extended onboarding columns
- `c91216c` — feat(fsm): 101_onboardingMachine v3 — player_fitness/age/goal chain
- `e1caef4` — feat(bot): extended onboarding + /settings command
- `f549dcf` — feat(auth): guard 403 ONBOARDING_REQUIRED + frontend block screen
- `728b2c1` — feat(scheduler): Job H — daily active_days_count + 120-day goal refresh
- `0709d8c` — fix(action-cube): remove orphan fetchRequests reference (black screen for responsibles)
- `d40bd62` — fix(onboarding): blocked-screen button via WebApp.openTelegramLink + bot auto-resume on /start + block free text in player_*_setup + 120-day warning text
- `d2e3a36` — feat(onboarding): /onboarding/wake endpoint — instant survey kick-off after Mini App close
- `b167b6f` — fix(auth): onboarding-block via response field (issue JWT) instead of 403 — unblocks /onboarding/wake

**Acceptance (2026-04-25): ✅ ALL PASSED**
- Шаг 1 ✅ Новый player (tg=156453252): полная цепочка пол→fitness→age→goal, все поля NOT NULL, Mini App открылся
- Шаг 2 ✅ Legacy guard (Dol tg=7458599391): JWT выдан, OnboardingBlockedScreen, кнопка «Пройти опрос» → /onboarding/wake → бот сразу прислал fitness keyboard → пройдено fitness/age/goal → Mini App разблокирован
- Шаг 3 ✅ /settings у заполненного (Dol): спросил только fitness/age/goal, gender=male не изменился, предупреждение «через 120 дней» отображается на шаге goal
- Шаг 4 (skip — Job H через SQL имитация)
- Шаг 5 ✅ 120-day trigger: SET active_days_count=120 + goal_update_required=true → Mini App у Dol заблокирован OnboardingBlockedScreen-ом
- Шаг 6 ✅ tsc/py_compile зелёные, ActionCube для Mr. больше не чёрный

**Файлы:**
- `backend/db/migrations/024_onboarding_extended.sql` — ✅ применена в Supabase (project `dlpdwmmfpzfxcelxqvlq`); колонки: fitness_level / age_range / goal / active_days_count / goal_update_required / goal_last_updated_at
- `fsm_blueprints/101_onboardingMachine.ts` — добавлены states + глобальный `RESET_GOAL_ONLY`
- `backend/handlers/onboarding.py` — process_gender → player_fitness_setup; новые callbacks fitness/age/goal; auto-resume на /start; блок свободного текста в player_*_setup; предупреждение «через 120 дней» на goal-step
- `backend/handlers/settings.py` — новый, `/settings` command
- `backend/keyboards/onboarding_keyboards.py` — 3 новых keyboards
- `backend/main.py` — settings_router подключён перед onboarding_router; включён onboarding_api_router
- `backend/api/routers/auth.py` — флаг `onboarding_blocked` в TokenResponse (НЕ 403; JWT всё равно выдаётся, чтобы /onboarding/wake мог сработать)
- `backend/api/routers/onboarding.py` — новый, `POST /onboarding/wake`: ставит state=player_fitness_setup и шлёт боту первый вопрос
- `backend/services/bot_notify.py` — расширен поддержкой `reply_markup`
- `backend/schedulers/subscription_lifecycle.py` — Job H (03:00 UTC, `increment_active_days`)
- `frontend/src/stores/authStore.ts` — поля `onboardingBlocked` + setter
- `frontend/src/hooks/useAuth.ts` — читает `data.onboarding_blocked` из ответа /auth/telegram
- `frontend/src/components/shared/OnboardingBlockedScreen.tsx` — кнопка «Пройти опрос» вызывает `/onboarding/wake` + `Telegram.WebApp.openTelegramLink` + `close()`
- `frontend/src/App.tsx` — рендер блок-скрина
- `frontend/src/components/cubes/ActionCube.tsx` — fix orphan `fetchRequests` (causal: чёрный экран у responsibles)

**Известные ограничения:**
- Bot push в Job H — best-effort: если cron сработал раньше lifespan (edge при рестарте) — push пропустится, `goal_update_required` всё равно проставится (Mini App заблокируется).
- `active_days_count` увеличивается ТОЛЬКО у player'ов с активной партнёркой. После expire счётчик не растёт (goal refresh не сработает у недействующих аккаунтов).
- Шаг 4 Acceptance (полный прогон Job H через python-shell) — пропущен (нет Railway shell); вместо него выполнена SQL-имитация в §Шаг 5.

## ▶️ Следующая точка входа (новый чат)

Этап 6 (Задачи 1–5) полностью закрыт. **Зафиксированный порядок Этапа 7:**

### 🥇 Задача 7.1 — Tier downgrade flow (СЛЕДУЮЩАЯ)
TODO из SESSION_23_PLAN §14/15. Когда Responsible переходит на тариф ниже (например Elite → Standard), у него может быть больше игроков чем разрешено новым тиром. Нужно:
- UX: при попытке downgrade — модалка «У вас N игроков, новый тариф позволяет M. Кого удалить?» с чек-боксами
- Backend endpoint: `POST /admin/promo/apply-tier-change-with-evictions {player_ids_to_evict: [...]}`
- Каскад: hard-delete партнёрств выбранных игроков → очистка их player_stats / shop_items / boosts
- Возвращать в TokenResponse актуальный `own_access_tier` после downgrade
- **Модель:** Sonnet + high effort

### 🥈 Задача 7.2 — Технический долг
Подробности раскрыты в комментарии Cowork-сессии 30:
- **4a) Drop `users.access_tier`** — миграция 025_drop_legacy_access_tier.sql + grep-аудит на остаточные ссылки + применение через Supabase MCP
- **4b) `_hidden_docs/` cleanup** — прочитать содержимое (`TEST_PLAN.md`, `code dlya workout.html` и др.), удалить мертвое или переместить в `_archive/`
- **4c) Лёгкая ruff-волна** — dead imports, unused functions
- **Модель:** Sonnet + medium effort

### 🥉 Задача 7.3 — E2E smoke на реальном устройстве
Прогон полного workout-flow в проде на iPhone/Android:
- /start → P-код → онбординг (gender/fitness/age/goal) → Mini App
- Camera permission → 35-минутная сессия с Gemini Vision evaluation
- Начисление Stars → покупка в Shop → списание freeze
- Verification: WakeLock работает, smart timer не сбивается, /workout/clip-uploads успешны
- **Модель:** Sonnet + medium (баги локальные, точечный фикс)

### 🏁 Задача 7.4 — Telegram Stars payments
Интеграция реального top-up через Stars (сейчас Stars начисляются автоматически после workout, но платёжного флоу нет):
- Aiogram pre-checkout query handler
- Pydantic-схемы для invoice
- Backend endpoint `/payments/create-invoice`
- UX в MarketCube: «Купить N Stars» с invoice-генератором
- Webhook для обработки successful_payment
- **Модель:** Opus + xhigh effort + ultrathink (новая платёжная архитектура, security-critical)

---

**ИТОГО:** последовательность для следующих 4 чатов: **7.1 → 7.2 → 7.3 → 7.4**

---

# SESSION STATUS — Session 29 (2026-04-25) — Этап 6 задачи 1–4 ✅ COMMITTED

## 🎉 Acceptance: COMPLETE ✅ (2026-04-24)
Все §§ 0–14 пройдены. Скипы: 2.3, 2.4, 3.3, 3.5, 4.1, 4.3–4.5, 9.4 — намеренные (race/manual).

## ✅ Smoke test bugfix batch 1 (2026-04-25) — commit `b223e1a`
Найдено 5 багов после деплоя Этапа 3. Реально сломаны 2 из 5:

- **Bug 2 FIXED (auth.py):** `own_access_tier` теперь возвращается для players (`player_access_tier`). Причина: `effectiveTier()` в authStore возвращает `ownAccessTier` когда `activeRoleView=null` (чистый player без toggle) — tier chip не показывался.
- **Bug 3 FIXED (onboarding.py):** P-code activation теперь спрашивает пол перед Mini App-кнопкой. Новый state `player_gender_setup` → `process_gender` его обрабатывает → сохраняет gender, ставит `onboardingComplete`.
- **Bug 1 (ActionCube gender guard):** Условие уже верное (`restDaysRemaining > 0 && gender === 'female'`). Изменений не требовалось.
- **Bug 4 (BondCube NotificationsSection):** Уже рендерится unconditionally на строке 102. Изменений не требовалось.
- **Bug 5 (MarketCube empty state):** «Магазин пуст» уже есть (строки 213-217). Изменений не требовалось.

## ✅ Этап 5 — Production prep (2026-04-24)
- Commit `bd6bde1` — feat(frontend): Этап 3 complete (22 files, 2789 ins / 380 del)
- Статус: **deployed + smoke tested + bugfixed**

## ✅ Этап 6 — задачи 1–4 (2026-04-25)

- [x] **Задача 1: XP rename** — `player_stats.star_balance` → `xp_balance` по всему стеку; миграция `023_rename_star_balance_to_xp.sql` применена в Supabase; backend: `workout.py`, `stats.py`, `admin.py`, `shop.py`; frontend: `api/stats.ts`, `api/admin.ts`, `DashboardSection.tsx`, `DashboardPanel.tsx`, `AdminCube.tsx`, `MarketCube.tsx`; tsc exit 0 — commit `(xp rename)`
- [x] **Задача 2: Фикс 404 `/renewal/my-requests`** — удалена `listMyRenewalRequests()` из `renewal.ts`; убраны `fetchRequests`, вызов в `Promise.all`, polling `useEffect` в `ActionCube.tsx`; state `requestsByPlayer` оставлен (badge не сломан); tsc exit 0 — commit `a057ff8`
- [x] **Задача 3: TierMatrixScreen рефакторинг** — убрана таблица 3×6 и кнопка «Сменить тариф»; добавлены 3 колонки (Standard/Premium/Elite) с фичами-заглушками (пирамида: 4/6/8); кнопка «⬆️ Попросить повышение» с haptic+toast; активный тир подсвечен рамкой; tsc exit 0 — commit `b39c8a7`
- [x] **Задача 4: Wallet chips ResponsibleView** — убраны «Магазин»/«Подарки»; добавлен «❄️ Заморозок: N» (N = shopFreezeBalance + giftFreezeBalance, всегда виден); tsc exit 0 — commit `(freeze chip)`

## ▶️ Следующая точка входа (новый чат) — Задача 5: Онбординг в боте

Большая задача (отдельный промпт, Opus):
- 4 вопроса после P-кода: пол (уже есть) → уровень подготовки → возраст → цель
- Команда `/settings` для повторного прохождения
- Повторный онбординг только каждые 120 дней активной подписки
- При напоминании бот блокирует Mini App до ответа
- Новые колонки БД: `fitness_level`, `age_range`, `goal`, `active_days_count`, `goal_update_required`, `goal_last_updated_at`

### Этап 3 — Frontend refactor ✅ COMPLETE
- [x] 3.1 authStore.ts — ownAccessTier/playerViewTier, wallet fields, effectiveTier getter, localStorage persistence ✅ (2026-04-24)
- [x] 3.2 API clients — admin/promo/partnerships/shop/notifications ✅ (2026-04-24)
- [x] 3.3 AdminCube CodeGeneratorPanel — 4 tabs (R-код, Renewal, Пачка, Список) ✅ (2026-04-24)
- [x] 3.4 ResponsibleView в ActionCube — wallet-row, getMyPlayers, ⋮ context menu; Renewal/BonusPack/GiftFreeze/TierChange modals; useAuth/setAuth расширены wallet-полями TokenResponse v2 ✅ (2026-04-24)
- [x] 3.5 MarketCube — live API getShopItems, ShopItemCard с freeze-highlight, freeze-balance chip, ResponsibleShop с player selector + GiftFreezeModal, skeleton/empty/error states ✅ (2026-04-24)
- [x] 3.6 PlayerView в ActionCube — status-row (tier/days/freeze chips), rest-day button (female+balance guard), renewal prompt от authStore.daysLeft, gender field в authStore + TokenResponse ✅ (2026-04-24)
- [x] 3.7 TierMatrixScreen — fullscreen tier comparison overlay, «ℹ️ Тарифы» trigger in PlayerView, static matrix 3×6, active-tier highlight, admin-contact toast ✅ (2026-04-24)
- [x] 3.8 Notification Center в BondCube — NotificationRenderer (6 types registry), NotificationList (skeleton/empty/mark-read/mark-all), NotificationsSection collapsible in BondCube, CSS, tsc exit 0 ✅ (2026-04-24)
- [x] 3.9 Global accessTier → effectiveTier audit — 0 legacy hits found (already migrated in 3.1–3.8); tsc exit 0 ✅ (2026-04-24)

**Состояние БД после Acceptance (2026-04-24):**
- Admin (tg=32267272): is_admin=true, has_responsible_access=true; responsible для Aziz (1 активное партнёрство)
- Aziz (tg=156453252): dual-role, has_responsible_access=true; player у Admin; responsible для P_F — 2 активных партнёрства
- P3/oil (tg=8580720783): **УДАЛЁН** в Test 13.8 (hard-delete, single partnership с Admin)
- P_F (tg=300099): player, partnership с Aziz (~15d)

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
- §12 Legacy cleanup ✅ 5/5 (2026-04-24)
- §13 Edge Cases ✅ 6/6 (13.3/13.5/13.7 skip; 13.6 Step 4 note: P3 male→gender guard before stats check; 2026-04-24)
  - **Архитектурная заметка 13.6:** rest-day STATS_NOT_FOUND reachable only via female player — gender guard fires first for male (correct behavior)
- §14 Final Checklist ✅ (46 PASS, 9 SKIP, 0 FAIL; 2026-04-24)

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

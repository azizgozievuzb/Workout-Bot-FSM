# SESSION_STATUS.md — Текущий статус и передача смены

> **AI-агент:** Прочитай этот файл ПОСЛЕ `CLAUDE.md`. Здесь написано, на чём остановился предыдущий агент.

**Последнее обновление:** 2026-04-15 (сессия 4, финал)
**Последний агент:** Claude Sonnet 4.6 (Cowork)

---

## ⚠️ ОТКРЫТЫЕ ВОПРОСЫ (НАПОМНИТЬ ПОЛЬЗОВАТЕЛЮ В НАЧАЛЕ СЕССИИ)

0. ✅ **Баг get_state ИСПРАВЛЕН** (коммит `89e43e0`).
1. ✅ **Hard black lock на фронте ПРИМЕНЁН** (коммит `cdc6c1b`).
2. ✅ **TTL баннер для Админа** — ИСПРАВЛЕН и запушен (сессия 2).
3. ✅ **AdminCube — панель "Соединения"** — РЕАЛИЗОВАНО и запушено (сессия 2).
4. ✅ **Скорость появления аватара** — РЕАЛИЗОВАНО (сессия 4, коммиты `1ba8f6d`, `0ee53c8`, `69408f3`).

5. **Архитектура Админа** — ОТЛОЖЕНА. Решить перед тренировочным интерфейсом.
> "Решаем вопрос архитектуры Админа сейчас или попозже?"

6. **Глобальная переработка Маркета** — ОТЛОЖЕНА. Решить перед тренировочным интерфейсом.
> "Прорабатываем глобальную логику Маркета сейчас или попозже?"

Контекст Маркета (для будущей сессии):
- Игрок покупает только за **звёзды** (которые набирает за тренировки)
- Ответственный покупает за **очки Ответственного** (за что-то начисляются — TBD) ИЛИ за **реальные Telegram Stars**
- В магазине будут **нативные лоты от приложения** + **лоты от Ответственного** (он их закидывает для своих игроков)
- Сейчас только заглушка: 5 готовых лотов + 6-й "Пустой лот" (некликабельный)

---

## ✅ Выполнено в этой сессии (2026-04-15, сессия 2)

### Backend
- **`backend/api/routers/promo.py`**: `GET /promo/player-status` — добавлен early return для admin/responsible (`is_active=True, days_left=None`). Устраняет баг: Admin/Responsible в P-view видели баннер "Доступ истекает" при переключении на P-вид.
- **`backend/api/routers/admin.py`**: добавлен `general_router` (`prefix="/admin"`) + endpoint `GET /admin/connections` — возвращает все пары Responsible→Players с флагом `is_deactivated`.
- **`backend/main.py`**: добавлен `admin_general_router` рядом с `admin_router`.

### Frontend
- **`frontend/src/components/cubes/ActionCube.tsx`**: `showExpiryBanner` теперь требует `promoStatus?.is_active === true`. Второй guard против ложного баннера.
- **`frontend/src/api/admin.ts`**: добавлены типы `PlayerInPair`, `ResponsibleGroup`, `ConnectionsResponse` + функция `getConnections()`.
- **`frontend/src/components/cubes/AdminCube.tsx`**: добавлен `ConnectionsPanel` + кнопка-переключатель "Соединения/Промокоды".
- **`frontend/src/styles/cubes.css`**: добавлены стили `.connections-group`, `.connections-responsible`, `.connections-player`, `.connections-empty`.

---

## ✅ Выполнено в этой сессии (2026-04-15)

### Backend
- **`backend/api/routers/admin.py`**: `GET /admin/promo/list` теперь по умолчанию фильтрует `code_type='responsible'`. Раньше в админку попадали авто-сгенерированные `player`-коды приглашения (баг: у Ответственного его player-invite код отображался в панели Админа среди responsible-промокодов).

### Frontend — Photo consent gate
- **`frontend/src/components/photo-gate/PhotoGate.tsx`**:
  - Добавлен state `consentChecked`.
  - В INTRO фазу добавлен чекбокс "Я понимаю, что я не смогу в дальнейшем поменять фотографию".
  - Кнопка "Открыть камеру" `disabled` пока чекбокс не проставлен.
- **`frontend/src/components/photo-gate/PhotoGate.css`**: стили `.pg-consent` + `.pg-btn--primary:disabled`.

### SQL (разовая операция пользователем)
Полный вайп всех данных включая админа:
```sql
TRUNCATE TABLE activity_feed, purchases, boosts, shop_items, player_stats,
  subscriptions, partnerships, promo_codes_archive, promo_codes, users
RESTART IDENTITY CASCADE;
```

### ⚠️ НАПОМИНАНИЕ: Нужен `git push` локально
Из песочницы push не работает (Missing permissions). Коммит(ы) этой сессии с фиксом админ-листа промокодов и photo-consent чекбоксом нужно запушить самому:
```
git add -A
git commit -m "fix(admin): filter promo list by responsible + photo consent checkbox"
git push
```

---

## 🔜 Первое действие следующей сессии

1. Применить фикс из промпта (см. ОТКРЫТЫЙ ВОПРОС №0): обернуть все `.maybe_single()` в защиту от `None`. Commit + push. Проверить что бот отвечает на /start.
2. Проверить `App.tsx` hard-lock: открыть MiniApp без промокода → должен быть чёрный экран с текстом "К сожалению, вы не зарегистрированы." и ничего кликабельного.
3. После этого — тестовый прогон TTL (см. ниже раздел "🔜 Что дальше").

---

## ✅ Выполнено в этой сессии (2026-04-14, продолжение) — Access Hardening

### Backend
- Добавил в `backend/core/deps.py` (коммит `5cae2f7`): `get_current_user` для роли player проверяет живую запись в `promo_codes` с `expires_at > now()`, self-heal `deactivated_at`, 403 `PROMO_EXPIRED`.
- `backend/api/routers/promo.py` — `GET /promo/player-status` использует ту же live-promo логику.
- **`backend/api/routers/auth.py`**: убран upsert. Теперь `.maybe_single()` + 403 `{"code": "NO_ACCESS"}` если юзера нет.
- **`backend/services/fsm/onboarding_fsm.py`**: частично защищены `.maybe_single()`, НО `get_state` всё ещё падает на `result.data` когда `result=None` — см. ОТКРЫТЫЙ ВОПРОС №0.
- **`backend/handlers/onboarding.py`**: убран `upsert_user`, `cmd_start` не создаёт row. Upsert юзера — только после успешной валидации промокода (admin/responsible) и в PAIR_ flow (player).

### Frontend
- **`src/api/client.ts`**: 403 interceptor обрабатывает `detail.code === "NO_ACCESS" | "PROMO_EXPIRED"`, вызывает `setToken(null)` + `setAccessRevoked(true)`.
- **`src/stores/authStore.ts`**: `setAccessRevoked(true)` чистит token и `isAuthenticated`.
- **`src/components/shared/AccessRevokedScreen.tsx`**: текст обновлён.
- ⚠️ Hard black lock (early return в `App.tsx`) — НЕ применён на проде, см. ОТКРЫТЫЙ ВОПРОС №1.

### Коммиты
- `5cae2f7` — auth(player): gate access on live promo_codes row + block miniapp entry for unknown users

### SQL-вайп (отработал)
Пользователь прогнал вайп всех данных кроме админа несколько раз (см. SQL в истории). После вайпа юзеров нет → бот падает на `/start` из-за бага `get_state`.

---

## ✅ Выполнено в этой сессии (2026-04-14) — Auth Gate: Block Unknown Users

### Backend
- **`backend/api/routers/auth.py`**: Removed upsert. POST /auth/telegram now does SELECT only via `.maybe_single()`. Returns 403 `{"code": "NO_ACCESS"}` if user not in DB.
- **`backend/services/fsm/onboarding_fsm.py`**:
  - `get_state`: `.maybe_single()` + returns `(None, {})` for missing user
  - `check_promo_rate_limit`: `.maybe_single()` + returns `{"allowed": True}` for new users
  - `record_failed_promo_attempt`: `.maybe_single()` + skips for new users
  - `validate_promo_code` step 3: `.maybe_single()` + skips `pending_promo_id` save for new users
  - Admin env code path: removed premature `.update()`, handler does upsert instead
- **`backend/handlers/onboarding.py`**:
  - Removed `upsert_user` function and its call in `cmd_start`
  - `cmd_start` shows promo prompt without creating user row
  - `process_text_input`: condition expanded to `db_state in ("resp_promo", None)` for new users
  - After promo success: upsert user row (admin: full fields; responsible: basic + role fields)
  - PAIR_ flow: upsert (not update) for new players
  - Removed "Сбрасываем в resp_promo" update block from bottom of `cmd_start`

### Frontend
- **`frontend/src/api/client.ts`**: 403 interceptor now handles `code === "NO_ACCESS"` OR `"PROMO_EXPIRED"` (detail can be object or string). Calls `setToken(null)` + `setAccessRevoked(true)`.
- **`frontend/src/stores/authStore.ts`**: `setAccessRevoked(true)` clears `token` and `isAuthenticated`.
- **`frontend/src/components/shared/AccessRevokedScreen.tsx`**: Updated text to "Нет доступа / Доступ не найден или истёк" (covers both NO_ACCESS and PROMO_EXPIRED).

## ✅ Выполнено в этой сессии (2026-04-14) — Promo TTL Lifecycle

### Migration 012 (`backend/db/migrations/012_promo_ttl.sql`)
- `promo_codes`: добавлены `duration_days` (7/30/90, default 30), `activated_at`, `activated_by`, `warn_sent`
- `promo_codes_archive`: новая таблица для архива истёкших кодов
- `users`: добавлены `deactivated_at`, `scheduled_deletion_at`

### Backend
- **`backend/schedulers/promo_lifecycle.py`** — APScheduler Jobs A/B/C:
  - Job A (10 мин): архивация истёкших кодов + деактивация юзеров
  - Job B (1 час): предупреждение Игрокам за 24ч до истечения
  - Job C (раз в сутки): cascade delete юзеров после 30 дней
- **`backend/main.py`**: APScheduler стартует в lifespan; зарегистрирован `admin_bot_router`
- **`backend/requirements.txt`**: добавлен `APScheduler==3.10.4`
- **`backend/core/deps.py`**: `get_current_user` проверяет `deactivated_at` для роли player → 403 PROMO_EXPIRED
- **`backend/api/routers/promo.py`**:
  - `_activate_player_code`: устанавливает `activated_at`, `activated_by`, `expires_at`, сбрасывает `deactivated_at` (реактивация)
  - Новый endpoint `GET /promo/player-status` — TTL статус для Игрока
  - `GET /promo/my-player-code` теперь возвращает `duration_days`, `expires_at`, `days_left`
- **`backend/api/routers/admin.py`**:
  - `POST /admin/promo/create` принимает `duration_days` (7/30/90)
  - Бот-команда `/new_promo` + inline-кнопки [7 дней][30 дней][90 дней] для создания промо
- **`backend/api/routers/stats.py`**: `PartnerStatsResponse` добавлены `is_deactivated`, `deactivated_at`

### Frontend
- **`src/api/client.ts`**: interceptor на 403 PROMO_EXPIRED → `setAccessRevoked(true)`
- **`src/stores/authStore.ts`**: добавлено `accessRevoked: boolean`, `setAccessRevoked()`
- **`src/components/shared/AccessRevokedScreen.tsx`**: новый экран с кнопкой закрытия (`WebApp.close()`)
- **`src/styles/cubes.css`**: стили для AccessRevokedScreen, player-expiry-banner, deactivated player row
- **`src/components/cubes/ActionCube.tsx`**:
  - PlayerView: чип с датой истечения + баннер если `days_left <= 1`
  - ResponsibleView: деактивированные игроки отображаются серыми (opacity 0.4) с бейджем "Доступ истёк" и кнопкой "Продлить"; empty state если нет активных игроков
- **`src/api/promo.ts`**: добавлены типы `MyPlayerCodeResponse`, `PlayerStatusResponse`, функция `getPlayerStatus()`
- **`src/api/stats.ts`**: `PartnerStats` добавлены `is_deactivated`, `deactivated_at`
- **`src/App.tsx`**: рендер `<AccessRevokedScreen>` при `accessRevoked=true`

## ✅ Выполнено ранее (2026-04-14)

### Bot (aiogram)
- **Приветствие** нейтральное: "Добро пожаловать! Введите промокод для активации:" (убрана преждевременная надпись "Вы — Ответственный").
- **После ввода промокода:** "✅ Промокод принят. Вы теперь Ответственный."
- **7-дневное предупреждение** на pair-link: добавлена фраза "если в течение 7 дней ссылка не активирована — возможность сгорает, и оплата за приглашение не возвращается."
- **FIX player_code:** `OnboardingService.create_player_invite_code()` (новый метод в `onboarding_fsm.py`) — идемпотентно создаёт `promo_codes` row с `code_type='player'` для Ответственного, чтобы `/promo/my-player-code` возвращал валидный код для мини-аппа. Вызывается в `handlers/onboarding.py` сразу после успешной активации промокода (и для admin, и для regular responsible).

### Frontend: Dashboard
- **`DashboardPanel.tsx`** (новый) — обёртка, один раз тянет данные (`getMyStats`, `getPartnerStats`, `getUnreadCount`) исходя из активной роли (`activeRoleView`).
- **`DashboardSection.tsx`** (переписан) — принимает `module`, `view`, `data`, `loading`, `onOpen`. Контент зависит от роли:
  - **Player:** Action (streak + "Начать тренировку"), Market (star_balance + "Магазин"), Bond (unread + "Профиль").
  - **Responsible:** Action ("Мои игроки" + количество), Market ("Подарить"/"Пополнить"), Bond (unread + "Связь").
  - **Admin:** Промокоды + Статистика (как было).
- **`DashboardRoleSwitch.tsx`** (новый) — глобальная P/R кнопка в Dashboard-оверлее. Использует тот же `.rt-btn` стиль (top-left, `position: fixed`, напротив крестика). Управляет `activeRoleView` в zustand.
- **App.tsx** — заменил inline map на `<DashboardPanel>`; добавил `<DashboardRoleSwitch>` в dashboard-оверлее.

### Frontend: ActionCube
- **Код приглашения** теперь компактный чип справа вверху (`.promo-invite-chip`), копирование по тапу. Большой блок удалён, CSS legacy-класс оставлен для совместимости.

### Стили
- `cubes.css`: добавлены `.promo-invite-chip-row`, `.promo-invite-chip`, `.promo-invite-chip-label`, `.promo-invite-chip-code`, `.promo-invite-chip-copy`.

---

## ✅ Что реализовано (полная картина)

### Frontend
- **Vite + React + TS** — Mini App в Telegram
- **4 куба** (Admin видит 4й): Action, Market, Bond, Admin
- **Gesture system:** hold+swipe-up → тема, tap → fullscreen, долгий hold → dashboard, swipe-left/right → карусель (+ trackpad wheel)
- **Dual-role:** кнопка P/R, `RoleTransition` с анимацией смены роли. В Dashboard — отдельный `DashboardRoleSwitch` (тот же стиль).
- **`activeRoleView`** в zustand (`authStore`) — роль не сбрасывается при свайпе карусели; guard `persistedAllowed` предотвращает показ чужой роли при смене пользователя.
- **Темы:** dark (космос) / light (туманность)
- **Крестик закрытия:** космическая сфера (чёрная дыра dark / Кассиопея light)
- **Backdrop:** ghost face + GlassCubes (canvas 3D) + Starfield/CloudField
- **ActionCube:** Player (streak, boost, rest days, "Приступим") + Responsible (игроки, компактный чип с кодом, кнопка ⚡X2)
- **MarketCube:** 5 лотов + "Пустой лот" (некликабельный)
- **BondCube:** Activity feed, кнопка переименована в "Связь"
- **AdminCube:** Управление промокодами
- **Dashboard:** real-data виджеты, role-aware контент, глобальная P/R кнопка

### Backend (Railway, Python 3.11 + FastAPI + Aiogram 3)
- **Auth:** JWT, validate initData, `get_current_user` dependency
- **Routers:** auth, users, partnerships, activity_feed, promo, admin, stats, shop, boosts
- **Promo:** `_create_player_code` (api) + `OnboardingService.create_player_invite_code` (bot) — оба пишут в `promo_codes` с `code_type='player'`
- **Telegram bot:** онбординг, обработчик промокода, нейтральные сообщения, 7-day warning

### Database (Supabase PostgreSQL)
- Миграции 001–011 применены
- Таблицы: users, partnerships, subscriptions, player_stats, shop_items, purchases, boosts, activity_feed, promo_codes
- RLS включён, service_role key используется на бэкенде
- **Reset:** SQL-скрипт для удаления всех данных кроме админа — отработал, проверено

---

## 🔜 Что дальше (приоритет)

### 0. ✅ Migration 012 применена в Supabase (проверено: `duration_days` присутствует)

### 1. Тестовый прогон после фиксов + TTL
- Запустить бот с нуля: /start → промокод Responsible → проверить, что в мини-аппе в ActionCube показывается код (чип справа вверху).
- Проверить Dashboard: реальные цифры (streak, balance, unread), смена роли через P/R кнопку.
- Проверить TTL: `/new_promo` → выбрать 7 дней → передать Игроку → активация → чип с датой истечения в ActionCube.
- Проверить деактивацию: вручную `UPDATE promo_codes SET expires_at = now() - INTERVAL '1 minute'` → Job A (10 мин) → Игрок получает 403 PROMO_EXPIRED → `AccessRevokedScreen` → у Ответственного серый игрок с "Продлить".

### 2. Тренировочный интерфейс (ГЛАВНАЯ ЦЕЛЬ)
- Кнопка "Приступим" / "Начать тренировку" → открывает `200_workoutSessionMachine`
- Камера (getUserMedia, landscape lock), WakeLock, таймер 35 мин
- Запись кусками → Gemini Vision → звёзды
- FSM: `200_workoutSessionMachine.ts`

### 3. Архитектура Админа (ОТЛОЖЕНО)
Обе роли без промокодов, NULL partnership как Игрок. См. блок "ОТКРЫТЫЕ ВОПРОСЫ".

### 4. Глобальная переработка Маркета (ОТЛОЖЕНО)
Нативные лоты + лоты Ответственного, разные валюты. См. блок выше.

### 5. rootMachine обновление + Unit tests

---

## 🐛 Известные особенности
- `.maybe_single()` supabase-py: ВСЕГДА проверять `if res is not None` перед `.data`
- Supabase service_role key обходит RLS — всё ок
- Railway деплой: green = успешно, но может занять 1-2 мин после push
- Vercel деплой: автоматически при push в main
- `npm run build` в песочнице падает из-за rolldown native binding — на реальной машине работает
- Git push из песочницы не работает (нет auth) — пуш локально

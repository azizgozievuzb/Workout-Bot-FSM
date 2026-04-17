# SESSION_STATUS.md — Текущий статус и передача смены

> **AI-агент:** Прочитай этот файл ПОСЛЕ `CLAUDE.md`. Здесь написано, на чём остановился предыдущий агент.

**Последнее обновление:** 2026-04-18 (сессия 11)
**Последний агент:** Claude Sonnet 4.6 (Cowork)

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

### 1. 🕳️ Продление доступа Игрока (СЛЕДУЮЩИЙ ЭПИК)
- Фундамент заложен: `renewal_requests` таблица, `is_renewal` флаг в `promo_codes`
- Нужны: UI Ответственного (создать renewal-код), UI Игрока (ввести код за 3–4 дня до истечения)
- Решение архитектуры: `code_type='player'` + `is_renewal=True` (флаг уже есть)

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

### 1. Тренировочный интерфейс (ГЛАВНАЯ ЦЕЛЬ)
- Кнопка "Приступим" → `200_workoutSessionMachine`
- Камера (getUserMedia, landscape lock), WakeLock, таймер 35 мин
- Запись кусками → Gemini Vision → звёзды
- FSM: `200_workoutSessionMachine.ts`

### 2. Архитектура Админа (ОТЛОЖЕНО)
Обе роли без промокодов, NULL partnership как Игрок.

### 3. Глобальная переработка Маркета (ОТЛОЖЕНО)
Нативные лоты + лоты Ответственного, разные валюты.

### 4. rootMachine обновление + Unit tests

---

## 🐛 Известные особенности
- `.maybe_single()` supabase-py: ВСЕГДА проверять `if res is not None` перед `.data`
- Supabase service_role key обходит RLS — всё ок
- Railway деплой: green = успешно, но может занять 1-2 мин после push
- Vercel деплой: автоматически при push в main
- `npm run build` в песочнице падает из-за rolldown native binding — на реальной машине работает
- Git push из песочницы не работает (нет auth) — пушить локально

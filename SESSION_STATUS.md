# SESSION_STATUS.md — Текущий статус и передача смены

> **AI-агент:** Прочитай этот файл ПОСЛЕ `CLAUDE.md`. Здесь написано, на чём остановился предыдущий агент.

**Последнее обновление:** 2026-04-12
**Последний агент:** Claude Opus 4.6

---

## СЛЕДУЮЩАЯ ЗАДАЧА

1. API-подключение — заменить мок-данные реальными запросами
2. rootMachine — обновить для новой навигации
3. Unit-тесты для cube-компонентов
4. Запустить миграцию 010_promo_v2.sql в Supabase SQL Editor

---

## Завершено за 2026-04-12 (сессия 12 — Карусель + Dashboard fullscreen + Промокод-модалка)

### Задача 1: Свайп-карусель в fullscreen
1. **App.tsx** — `AnimatePresence mode="wait"` + `motion.div` с `carouselVariants` (slide left/right). `nextModule()` зацикленная навигация Action→Market→Bond→Action
2. **Горизонтальный свайп** — `pointerStartX` + deltaX > 50px + elapsed < 500ms + `|deltaX| > |deltaY|` (не конфликтует с вертикальным свайпом темы)
3. **Carousel dots** — 3 точки внизу fullscreen, активная увеличена (`carousel-dot.active`)
4. **Первый вход** — `swipeDir=0` → fade без слайда (carouselVariants проверяет `dir ? dir*300 : 0`)

### Задача 2: Dashboard fullscreen
5. **dashboard.css** — `.dashboard-panel`: убраны `max-width: 400px`, `margin: auto`, `border-radius`. `height: 100%`
6. **App.css** — `.overlay-dashboard`: `padding: 0` (убраны `align-items: center`, `justify-content: center`)
7. **DashboardSection.tsx** — `PRIMARY_ITEMS` (видны сразу: кнопки workout/shop, стрик, баланс) + `MORE_ITEMS` (в dropdown "Ещё ▼": статистика, отдых, лутбоксы, достижения, настройки)
8. **`.dashboard-section`** — `flex: 1` (равное распределение высоты между секциями)
9. **Новые CSS** — `.dashboard-primary`, `.dashboard-primary-item` (`.accent` = синий), `.dashboard-more-toggle`

### Задача 3: Промокод-модалка
10. **Уже реализовано в сессии 10** — `PromoCodeModal.tsx` + `RoleTransition.tsx` (promoOpen вместо toast). API-активация через `activatePromo()`, `addRole()`, `setPlayerCode()`

### Проверка
11. **tsc --noEmit** — чисто

---

## Завершено за 2026-04-12 (сессия 11 — Бот-обработчик промокода + админ player_code)

### Задача 1: onboarding.py — единое сообщение + блокировка
1. **Ошибка промокода** — одно сообщение: `"Осталось X попыток, введите код повторно."` или `"❌ Слишком много попыток. Повторите через X мин."`
2. **Блокировка команд** — в `resp_promo` любая команда кроме `/start` → `"Пожалуйста, введите только промокод."`
3. **Non-text handler** — стикеры/фото/голосовые в `resp_promo` → `"Пожалуйста, введите только промокод."`

### Задача 2: promo.py — админ-код генерирует player_code
4. **_create_player_code()** — общий хелпер, используется и для responsible, и для admin (без дублирования)
5. **Админ-блок** — проверка `is_admin` (защита от повторной активации), `primary_role=responsible`, `onboarding_done=True`, генерация player_code
6. **Responsible-блок** — переведён на `_create_player_code()` хелпер

### Задача 3: config.py + .env.example
7. **config.py** — `ADMIN_PROMO_CODE: str = ""` ✓ (из env, не хардкод)
8. **.env.example** — `ADMIN_PROMO_CODE`, `BOT_USERNAME` ✓
9. **ast.parse** — оба файла OK

---

## Завершено за 2026-04-12 (сессия 10 — Промокод-система v2, фронтенд)

### Задача: Фронтенд промокод-системы (PROMPT_PROMO_FRONTEND.md)
1. **promo.ts** — `frontend/src/api/promo.ts`: activatePromo, activatePromoLink, getMyPlayerCode
2. **authStore** — добавлены player_code, setPlayerCode, addRole (для добавления второй роли)
3. **OnboardingFlow.tsx** — полностью переписан: promo → congratulations → photo → complete. Deep link auto-activation через start_param (UUID). Rate limit UI (3 попытки, обратный отсчёт блокировки)
4. **PromoCodeModal.tsx** — новый компонент: модалка для разблокировки второй роли при тапе на кнопку P/R
5. **ActionCube.tsx** — ResponsibleView: invite-блок с промокодом (getMyPlayerCode API), копирование кода/ссылки, toast
6. **RoleTransition.tsx** — при denied открывается PromoCodeModal вместо toast
7. **App.tsx** — onboarding показывается для всех ролей (убрано условие role === 'player')
8. **CSS** — OnboardingFlow.css (promo-screen, congrats-screen), cubes.css (promo-invite-block), promo-modal.css (модалка)
9. **tsc --noEmit** — чисто

---

## Завершено за 2026-04-12 (сессия 9 — Промокод-система v2, бэкенд)

### Задача: Новая промокод-система (backend)
1. **Миграция 010** — `backend/db/migrations/010_promo_v2.sql`: code_type (responsible/player/admin), parent_code_id, responsible_id, deep_link_token, expires_at + индексы
2. **POST /promo/activate** — `backend/api/routers/promo.py`: универсальная активация. Rate limit (3/час), admin code из env, responsible_code → генерация player_code, player_code → partnership + mark used
3. **GET /promo/my-player-code** — возвращает неиспользованный player_code + deep_link для ответственного
4. **POST /promo/activate-link/{token}** — активация через deep link token (та же логика что player_code)
5. **POST /admin/promo/create** — `backend/api/routers/admin.py`: генерация N responsible-кодов (формат R-XXXXXX), только для is_admin=true
6. **GET /admin/promo/list** — список всех кодов с фильтрами (code_type, is_used, tier)
7. **auth.py** — добавлено поле `has_promo_code: bool` в TokenResponse + логика проверки
8. **onboarding.py** — обработка UUID deep link токена: `/start <uuid>` → redirect в Mini App с startapp параметром. Старый PAIR_ flow сохранён
9. **config.py** — добавлены `ADMIN_PROMO_CODE`, `BOT_USERNAME` в Settings
10. **.env.example** — добавлены `ADMIN_PROMO_CODE`, `BOT_USERNAME`
11. **main.py** — подключены promo_router и admin_router
12. **Все .py файлы парсятся без ошибок** (ast.parse OK)

---

## Завершено за 2026-04-12 (сессия 8 — UX-фиксы: жесты, dashboard, кнопка роли)

### Задача 1: Жесты — fullscreen exit только long press 3с
1. **handleGestureUp** — убран блок `cur === 'fullscreen'` → тап больше не сворачивает куб
2. **handleGestureDown** — setTimeout уже обрабатывал `else` (не chaos) → chaos, теперь покрывает fullscreen→chaos
3. **gesture-layer** — `pointer-events: auto` только в chaos mode. В fullscreen/dashboard — `none`, события идут через overlay
4. **overlay-fullscreen** — добавлены `onPointerDown/onPointerUp` для жестов (long press + swipe)
5. **overlay-dashboard** — аналогично, жесты на самом overlay

### Задача 2: Кнопка роли — 48px, EHT + Cassiopeia A
6. **rt-btn** — 48×48px, top: 12px, font-size: 22px
7. **Dark theme (EHT)** — radial-gradient чёрный диск + оранжевое кольцо аккреционного диска, ассиметричный box-shadow (верх ярче), idle: `hue-rotate` вращение свечения
8. **Light theme (Cassiopeia A)** — 5 radial-gradient (зелёный, красный, синий, жёлтый, белое ядро), idle: `brightness` + `hue-rotate` пульсация
9. **Single vs dual** — single: приглушённые цвета. dual: полная яркость + вращающийся ring
10. **Letter P/R** — dark: белая с glow. light: тёмная с text-shadow
11. **rt-content** — padding-top: 70px (контент ниже кнопки)
12. **rt-toast** — top: 72px (под увеличенной кнопкой)
13. **rt-void-dark** — gradient center обновлён 42px 36px
14. **RoleTransition.tsx** — transformOrigin: '42px 36px'

### Задача 3: Dashboard — единая панель с dropdown-секциями
15. **DashboardSection.tsx** — новый компонент: заголовок + стрелка ▼ + AnimatePresence dropdown
16. **Подменю:** Action (4 пункта), Market (3 пункта), Bond (4 пункта)
17. **dashboard.css** — `.dashboard-panel` glassmorphic, `.dashboard-divider`, `.dashboard-section-*`, `.dashboard-dropdown-item` + light theme
18. **App.tsx** — убран крестик (overlay-close), новая структура: overlay-dashboard → dashboard-panel → DashboardSection × 3
19. **App.css** — удалены `.dashboard-card*` стили, `.overlay-dashboard` обновлён (center alignment)
20. **handleClose** — удалён (не используется)

### Задача 4: Gesture matrix
| Контекст | Тап | Long press 3с | Hold + swipe up |
|---|---|---|---|
| Chaos | Куб → fullscreen | → Dashboard | Смена темы |
| Fullscreen | Ничего (UI куба) | → Chaos | Смена темы |
| Dashboard | Ничего (dropdown) | → Chaos | Смена темы |

21. **tsc --noEmit** — чисто

---

## Завершено за 2026-04-12 (сессия 7 — Gravity Collapse + Supernova)

### Анимация переключения ролей
1. **ThemeContext** — `frontend/src/contexts/ThemeContext.tsx`: React Context для передачи темы (`dark`/`light`) из App.tsx в компоненты без DOM-запросов
2. **RoleTransition** — `frontend/src/components/shared/RoleTransition.tsx`: общий компонент анимации для всех 3 кубов. Фазы: idle → exiting → void (500ms) → entering → idle. framer-motion `AnimatePresence` mode="wait"
3. **Gravity Collapse (dark)** — кнопка-чёрная дыра: radial-gradient #0a→#222, conic-gradient accretion disk (rt-ring), idle pulse (bh-idle), active intensified glow + fast spin. Exit: scale→0 + skew к точке кнопки (transformOrigin: 36px 36px). Void: radial glow от позиции кнопки. Enter: big bang expansion из точки
4. **Supernova (light)** — кнопка-звезда: gold gradient, conic-gradient rays, idle pulse (star-idle), active white flash + scale 1.1. Exit: scale→1.15 + blur 10px (взрыв наружу). Void: golden glow от центра. Enter: crystallize из blur→sharp
5. **Denied state** — dual=false: dark — 2 pulse (bh-denied), light — 3 flicker (star-denied) + toast с сообщением (2с, framer-motion fade)
6. **Single vs dual** — rt-single (dim glow, no ring) vs rt-dual (active glow + rotating ring). Визуально очевидно доступна ли вторая роль
7. **Accessibility** — `prefers-reduced-motion: reduce` → instant switch без анимации (JS check + CSS override)
8. **Performance** — `will-change: transform, opacity`, GPU-accelerated properties only, blur ≤10px
9. **cubes.css** — удалён старый `.cube-role-toggle`, добавлен `position: relative` на `.cube-module`
10. **App.tsx** — обёрнут в `ThemeContext.Provider`
11. **tsc --noEmit** — проходит чисто

---

## Завершено за 2026-04-12 (сессия 6 — UI-скелеты кубов)

### Frontend: cube UI skeletons (мок-данные, без API)
1. **ActionCube** — `frontend/src/components/cubes/ActionCube.tsx`: Player-вид (кнопка "Приступим", стрик, буст X2, fun fact, день отдыха) + Responsible-вид (список игроков с пинг-кнопками, буст X2) + locked screens
2. **MarketCube** — `frontend/src/components/cubes/MarketCube.tsx`: Player-магазин (баланс 150, сетка 5 товаров с ценами) + Responsible-магазин (табы по игрокам, пополнение) + locked screens
3. **BondCube** — `frontend/src/components/cubes/BondCube.tsx`: Player-лента (4 события, бейджики, профиль) + Responsible-лента (3 события, инвайт, уведомления, биллинг) + locked screens
4. **cubes.css** — `frontend/src/styles/cubes.css`: glassmorphic карточки, role toggle (dark=чёрная дыра, light=звезда), shop grid, feed cards, badges, tabs, locked screens, balance display, rest day button
5. **App.tsx** — `ModuleName` обновлён `Action|Market|Bond` (было `Workout|Arsenal|Responsibility`), dashboard карточки обновлены, fullscreen рендерит соответствующий *Cube компонент
6. **overlay-body** — изменён с центрированного на flex-column для скроллируемого контента кубов
7. **tsc --noEmit** — проходит чисто

### Паттерн dual-role в кубах:
- Каждый куб читает `useAuthStore` → строит `DualRoleUser` → использует `canPlay()` / `canMonitor()` / `isDualRole()`
- Toggle-кнопка в углу (P/R) переключает между Player и Responsible видами
- Если роль недоступна — серый locked screen с инструкцией разблокировки
- `e.stopPropagation()` на всех интерактивных элементах чтобы тап не закрывал fullscreen

---

## Завершено за 2026-04-12 (сессия 5 — Smoke-тесты dual-role)

### Backend: smoke tests (`backend/tests/test_dual_role.py`)
1. **Pydantic schema validation** — TokenResponse имеет dual-role поля (primary_role, has_player_access, has_responsible_access, is_admin), все bool-типы корректны. FeedResponse/UnreadCountResponse/MarkReadResponse — схемы валидны. **12/12 passed**
2. **Endpoint availability** — POST /auth/telegram доступен (422 без body). Feed endpoints — 404 (не задеплоены, код ещё untracked в git)
3. **Integration mode** — полные тесты с BOT_TOKEN (auth → feed GET/POST). Запуск: `BOT_TOKEN=xxx python3 backend/tests/test_dual_role.py`

### Frontend: role utils tests (`frontend/src/utils/__tests__/roles.test.ts`)
4. **vitest** установлен как devDependency
5. **17 тестов** для isDualRole, canPlay, canMonitor, isAdmin, getActiveRoles — 4 мок-юзера (player-only, responsible-only, dual-role, admin). **17/17 passed**

---

## Завершено за 2026-04-12 (сессия 4 — Frontend dual-role infra)

### Frontend: dual-role типы, стор, утилиты, API
1. **Типы** — `authStore.ts`: экспортируемые `PrimaryRole`, `LegacyRole`, `DualRoleUser` interface. Новые поля: `primary_role`, `has_player_access`, `has_responsible_access`, `is_admin`. Старое `role` сохранено для совместимости
2. **Zustand store** — `setAuth()` принимает объект с новыми полями. Fallback: если бэкенд не вернул dual-role поля, вычисляются из legacy `role`
3. **useAuth hook** — парсит все dual-role поля из `/auth/telegram` ответа, возвращает их компонентам
4. **OnboardingFlow** — обновлён под новую сигнатуру `setAuth()`
5. **Role helpers** — `frontend/src/utils/roles.ts`: `isDualRole()`, `canPlay()`, `canMonitor()`, `isAdmin()`, `getActiveRoles()`
6. **Activity Feed API** — `frontend/src/api/activityFeed.ts`: `getFeed()`, `markAsRead()`, `getUnreadCount()` через общий axios instance
7. **TypeScript** — `tsc --noEmit` проходит чисто

---

## Завершено за 2026-04-12 (сессия 3 — Backend dual-role)

### Backend: dual-role system (миграции 007-009)
1. **Pydantic-модели** — `backend/models/user.py`: `UserDualRole` (primary_role, has_player_access, has_responsible_access, is_admin), `PlayerStatsRest` (rest_days_remaining, rest_days_used_this_month)
2. **Auth endpoint** — `TokenResponse` возвращает dual-role поля. Backward-compat: `role` вычисляется из `primary_role` + `is_admin`
3. **Onboarding** — при регистрации игрока пишет `primary_role="player"`, `has_player_access=true`. Ответственный: `primary_role="responsible"`, `has_responsible_access=true`. Старое поле `role` пишется параллельно
4. **Activity Feed API** — `backend/api/routers/activity_feed.py`: GET /feed (пагинация), POST /feed/read (mark read), GET /feed/unread-count. Подключён в main.py

---

## Завершено за 2026-04-12 (сессия 2 — Brainstorm + Visual)

### Брейншторм: новая архитектура навигации
1. **3 куба** утверждены: Action (действие), Market (экономика), Bond (связь)
2. **Двойная роль** — прогрессивная система: оба экрана видны всегда, неактивный серый с инструкцией разблокировки
3. **Gravity Collapse** (dark) / **Supernova** (light) — анимация переключения ролей
4. **Bond-стратегия** — push-тизеры через бота, полный контент только в приложении
5. **3 дня отдыха** для девушек (раз в месяц, сгорают если не использованы)
6. **Все 13 крючков удержания** распределены по кубам

### Визуальная реализация
7. **Labels** переименованы: Arsenal/Workout/Responsibility → Action/Market/Bond
8. **Тёмная тема — голограммные кубы:** полупрозрачные грани, электрические импульсы по рёбрам, глич-эффект на пустых гранях (рассинхронизирован между кубами), мягкая коррекция вращения (текст не пропадает надолго)
9. **Светлая тема — объёмные овалы:** jelly wobble (пульсация формы), каустики, 3 импульса по разным орбитам (параллель/меридиан/диагональ) по всей поверхности с depth-эффектом, подвижный блик, усиленный фреснель для глубины
10. **Текст усилен** на обеих темах (glow + shadow + повышенная читаемость)
11. **Gesture layer** — разблокирован при Network Error (смена темы работает)

> Решения ниже приняты Азизом 2026-04-12 в ходе брейншторм-сессии.

---

### НОВАЯ АРХИТЕКТУРА НАВИГАЦИИ — 3 КУБА

Chaos mode с 3D стеклянными объектами сохраняется (wow-эффект). Кубы переименованы и переосмыслены.

**Куб 1 — ACTION (Действие)**
Точка входа в активность. Внутри ВСЕГДА видны два экрана — Игрок и Ответственный.
- Активная роль — полноценный интерфейс
- Неактивная роль — серый/заблокированный экран с объяснением как разблокировать

*Игрок видит:*
- "Приступим" → запуск тренировки (workoutGate → workoutSession)
- "На сегодня всё" + статистика дня (если уже тренировался)
- Текущий стрик, активный буст X2, окно уровней
- Fun Facts AI (если тренировка уже сделана)
- Кнопка "3 дня отдыха" для девушек (раз в месяц)
- Серый экран "Ответственный" → "Введите промокод чтобы стать Ответственным"

*Ответственный видит:*
- Список игроков + статус (тренировался/нет)
- Стрики игроков, кнопка "Пинг" (кулдаун 6ч)
- Магазин бустов X2 (день/неделя)
- Серый экран "Игрок" → "Вам нужна пригласительная ссылка"

*Переключение между ролями — два режима анимации:*

**Dark theme → Gravity Collapse (Гравитационный коллапс):**
Кнопка — маленькая чёрная дыра в углу экрана.
- Тап (обе роли активны) → все UI-элементы гравитационно стягиваются в точку, деформируясь → секунда тишины → "большой взрыв" — элементы другой роли разлетаются по местам
- Тап (роль недоступна) → дыра пульсирует, но не поглощает; появляется сообщение
- Цветная если 2 роли, серая если 1

**Light theme → Supernova (Сверхновая):**
Кнопка — маленькая пульсирующая золотая звезда в углу экрана.
- Тап (обе роли активны) → звезда вспыхивает белым светом → UI-элементы разлетаются наружу, разбиваясь на световые частицы → секунда белого свечения → из золотистой пыли кристаллизуются элементы другой роли
- Тап (роль недоступна) → звезда мерцает, но не вспыхивает; появляется сообщение
- Золотая/яркая если 2 роли, тусклая если 1

**Концепция пары:** Collapse (смерть звезды) ↔ Supernova (рождение звезды). Один процесс с двух сторон.

**Куб 2 — МАГАЗИН (Экономика)**
- Игрок (только): сразу в магазин → каталог (скипы, аватары, лутбоксы, тролл, хардкор), баланс звёзд
- Ответственный (только): сразу в пополнение → магазины для каждого игрока
- Оба: выбор — покупать (свой магазин) или пополнять (магазины игроков)
- Если 3 игрока у Ответственного → 3 отдельных магазина для пополнения

**Куб 3 — BOND (Связь)**
Социальный куб. Все крючки удержания живут здесь.
- Игрок: лента от Ответственного (бусты, пинги, реакции), достижения/бейджики, профиль + настройки
- Ответственный: лента событий игроков ("Алексей завершил тренировку +45⭐", "Марина потеряла стрик", "Дима купил аватар"), настройки уведомлений, инвайт-ссылки, подписка/биллинг

*Push-уведомления (Bond-стратегия):*
Telegram-бот присылает ТИЗЕР ("У вас обновление от Игрока Алексей"), полный контент — только внутри куба Bond в Mini App. Крючок: любопытство → открытие приложения.

---

### ИЗМЕНЕНИЯ В СХЕМЕ БД

**USERS — новые поля:**
```
- primary_role ("player" | "responsible")  — как зарегистрировался
- has_player_access (BOOLEAN, default FALSE) — может тренироваться
- has_responsible_access (BOOLEAN, default FALSE) — может мониторить
- is_admin (BOOLEAN, default FALSE) — только Азиз
```
Старое поле `role` заменяется на `primary_role` + флаги доступа.
При регистрации Игрока: `primary_role="player"`, `has_player_access=true`.
При регистрации Ответственного: `primary_role="responsible"`, `has_responsible_access=true`.
Разблокировка второй роли: Игрок вводит промокод → `has_responsible_access=true`. Ответственный принимает инвайт → `has_player_access=true`.
Правило: `responsible_id ≠ player_id` (сам себе ссылку отправить нельзя).

**PLAYER_STATS — новые поля:**
```
- rest_days_remaining (INTEGER, default 3) — дни отдыха (только gender="female")
- rest_days_used_this_month (INTEGER, default 0)
```
Scheduler: 1-го числа каждого месяца сбрасывает `rest_days_remaining=3`, `rest_days_used_this_month=0`.

**ACTIVITY_FEED — новая таблица:**
```
- id (PK, UUID)
- target_user_id (FK → users.id) — кому показывать
- source_user_id (FK → users.id) — от кого событие
- event_type ("workout_done" | "streak_lost" | "shop_purchase" | "boost_activated" | "ping" | "milestone")
- payload (JSONB) — детали события
- is_read (BOOLEAN, default FALSE)
- created_at (TIMESTAMP)
```

---

### МАППИНГ FSM → КУБЫ

| FSM-машина | Куб | Роль |
|---|---|---|
| workoutGateMachine + workoutSessionMachine | ACTION | Игрок |
| responsibleMachine | ACTION | Ответственный |
| playerShopMachine | МАГАЗИН | Игрок |
| paymentMachine | МАГАЗИН | Ответственный |
| onboardingMachine | Отдельный флоу (до кубов) | Все |
| adminMachine | Скрытый режим (не куб) | Только Азиз |
| rootMachine | Роутер (определяет контент кубов) | Все |

### ФОНОВЫЕ ПРОЦЕССЫ (не в кубах)
- 00:00 — сброс дневного лимита
- 01:00 — проверка стриков
- 06:00 — проверка подписок
- 19:00 — вечернее напоминание (push)
- Каждый час — проверка бустов
- 1-е число месяца — сброс дней отдыха

### Жестовая логика (без изменений)
- Тап по кубу (chaos) → fullscreen модуль
- Тап (fullscreen) → назад в chaos
- Long press 3 сек → toggle chaos ↔ dashboard
- Hold 0.5с + swipe up → смена темы

---

## Завершено за 2026-04-12

### AI-стилизация селфи (все 12 шагов)
1. Все 12 шагов из предыдущей сессии были уже реализованы
2. **Фикс Gemini модели** — `gemini-2.0-flash-exp` (404) → `gemini-2.5-flash-image` (работает)
3. **Фикс утёкшего API ключа** — Google заблокировал ключ через GitHub Secret Scanning. Создан новый ключ, старый удалён из репо
4. **Промпты Cosmic/Meditation** — переписаны: полное фото → Gemini сам вырезает лицо лассо → сильная стилизация → fullscreen wallpaper 9:16
5. **Cosmic промпт уточнён** — контуры лица чёткие, глаза остаются человеческими, сияющие объекты на лице
6. **Dashboard exit** — выход из dashboard только через long press 3с (не тапом)

---

## Завершено за 2026-04-11

### PhotoGate (полный цикл)
1. **PhotoGate компонент** — камера, овальная рамка, face detection (FaceDetector API + fallback), обратный отсчёт 3-2-1, захват, превью, retake, upload
2. **POST /users/me/photo** — base64 JPEG → Supabase Storage (бакет avatars) → profile_photo_url в БД
3. **Auth response** — возвращает profile_photo_url
4. **Backdrop** — персональное фото вместо стоковых woman_cosmic/woman_meditating
5. **Intro-экран** — предупреждения: хорошее освещение + фото одноразовое (замена платная)
6. **Ref callback** — видеоэлемент монтируется через callback ref (решает AnimatePresence race condition)
7. **Чёрный loading-screen** — предотвращает мелькание кубов до загрузки auth

### Баг-фиксы
8. **Свайп + тема** — убран framer-motion onPanEnd, свайп через pointer events в gesture-layer
9. **gesture-layer** — отключается при активных оверлеях (PhotoGate, Onboarding, loading)
10. **Supabase Storage** — x-upsert header, manual public URL construction (async client issue)
11. **Camera retake** — полный cleanup + перезапуск через ref callback

### Инфраструктура
- Supabase Storage бакет `avatars` (public) — создан
- GEMINI_API_KEY — задан в Railway env (не коммитить!)

---

## Бизнес-правила (утверждены с Азизом)
- Любой кто заходит напрямую → Ответственный
- Игрок — ТОЛЬКО по пригласительной ссылке
- **1 промокод = 1 ссылка = 1 человек глобально**
- Basic: 1 игрок. Premium: 3 игрока
- Ссылка живёт 7 дней
- **Фото обязательно для ВСЕХ** в Mini App
- **Фото делается один раз. Повторная замена — платная**
- 3 неверных промокода в час → блокировка на 1 час

## Известные баги
- `@telegram-apps/sdk-react` deprecated → нужно мигрировать на `@tma.js`

## ВАЖНО
- Пользователя зовут **Азиз** (не Николай)
- Supabase CLI залогинен — перед возвратом компьютера Николаю: `supabase logout`
- **Vercel env:** `VITE_API_URL=https://workout-bot-fsm-production-0e08.up.railway.app`
- **Railway env:** `MINI_APP_URL=https://workout-bot-fsm.vercel.app`
- **Railway env:** `GEMINI_API_KEY` — задан (не коммитить в репо!)

## SQL для сброса тестовых данных
```sql
DELETE FROM partnerships;
UPDATE users SET onboarding_state = NULL, onboarding_done = false, pending_promo_id = NULL, promo_attempts = 0, promo_locked_until = NULL, profile_photo_url = NULL, photo_dark_url = NULL, photo_light_url = NULL, photo_processing = false;
UPDATE promo_codes SET is_used = false, used_by = NULL, used_at = NULL;
```

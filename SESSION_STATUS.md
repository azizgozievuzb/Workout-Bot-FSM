# SESSION_STATUS.md — Текущий статус и передача смены

> **AI-агент:** Прочитай этот файл ПОСЛЕ `CLAUDE.md`. Здесь написано, на чём остановился предыдущий агент.

**Последнее обновление:** 2026-04-14
**Последний агент:** Claude Opus 4.6

---

## ⚠️ ОТКРЫТЫЕ ВОПРОСЫ (НАПОМНИТЬ ПОЛЬЗОВАТЕЛЮ В НАЧАЛЕ СЕССИИ)

1. **Архитектура Админа** — ОТЛОЖЕНА. Спросить:
> "Решаем вопрос архитектуры Админа сейчас или попозже?"

2. **Глобальная переработка Маркета** — ОТЛОЖЕНА. Спросить:
> "Прорабатываем глобальную логику Маркета сейчас или попозже?"

Контекст Маркета (для будущей сессии):
- Игрок покупает только за **звёзды** (которые набирает за тренировки)
- Ответственный покупает за **очки Ответственного** (за что-то начисляются — TBD) ИЛИ за **реальные Telegram Stars**
- В магазине будут **нативные лоты от приложения** + **лоты от Ответственного** (он их закидывает для своих игроков)
- Сейчас только заглушка: 5 готовых лотов + 6-й "Пустой лот" (некликабельный)

---

## ✅ Выполнено в этой сессии (2026-04-14)

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

### 1. Тестовый прогон после фиксов
- Запустить бот с нуля: /start → промокод Responsible → проверить, что в мини-аппе в ActionCube показывается код (чип справа вверху).
- Проверить Dashboard: реальные цифры (streak, balance, unread), смена роли через P/R кнопку.

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

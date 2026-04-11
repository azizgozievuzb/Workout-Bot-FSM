# 📂 SESSION_STATUS.md — Текущий статус и передача смены

> **AI-агент:** Прочитай этот файл ПОСЛЕ `CLAUDE.md`. Здесь написано, на чём остановился предыдущий агент.

**Последнее обновление:** 2026-04-11 (ночь)
**Последний агент:** Claude Opus 4.6

---

## 🎯 Текущий фокус
ТЕСТИРОВАНИЕ онбординга v3. Все 4 фикса из PROMPT_FIX_V3 применены. Задеплоено на Railway + Vercel.

## 🚀 СЛЕДУЮЩАЯ ЗАДАЧА — ТЕСТИРОВАНИЕ

**Нужно сбросить БД** через Supabase Dashboard → SQL Editor:
```sql
UPDATE users SET onboarding_state = NULL, onboarding_done = false, pending_promo_id = NULL, promo_attempts = 0, promo_locked_until = NULL;
UPDATE promo_codes SET is_used = false, used_by = NULL, used_at = NULL;
UPDATE partnerships SET status = 'expired' WHERE status = 'pending';
```

**Тестовые промокоды (одноразовые!):**
- `Promocod100` — basic (1 игрок)
- `Promocod300` — premium (3 игрока)

**Тест-план:**
1. `/start` → промокод → язык → пол → имя → ссылка + кнопка "Открыть приложение"
2. Ссылка в `<code>` блоке (нажал = скопировал) + кнопка "Поделиться"
3. Ответственный сразу видит 3D кубы в Mini App
4. Игрок по ссылке → язык → пол → опрос → Mini App (Survey → Photo)
5. Desktop Telegram → "Откройте приложение с телефона" (не техническая ошибка)

---

## ✅ Завершено за сегодня (2026-04-11 ночь)

### Фиксы из PROMPT_FIX_V3.md
1. **Кнопка "Открыть приложение" сразу после ссылки** — Ответственный видит miniapp кнопку без повторного /start.
2. **Улучшен текст ссылки** — `<code>` блок для копирования, предупреждения об одноразовости, только кнопка "Поделиться".
3. **Убрана техническая ошибка initData** — вместо "No Telegram initData" показывается "Откройте приложение с телефона".
4. **Удалены промпт-файлы** — PROMPT_FIX_3_ISSUES.md, PROMPT_FIX_ONBOARDING_V2.md, PROMPT_QUICK_FIX.md, PROMPT_FIX_V3.md.

### Ранее (2026-04-11)
- Убран дублирующий онбординг из фронтенда
- Кнопки копирования ссылки (InlineKeyboardMarkup)
- Убран мокап телефона

---

## ✅ Завершено за сегодня (2026-04-11)

### Фиксы бота
1. **Исправлен краш при генерации ссылки** — `pairing_code` NOT NULL constraint. Бот молчал после ввода имени игрока. Теперь пишет и в `pairing_code`, и в `pair_code`.
2. **Добавлен error handling** — вместо молчания бот теперь отвечает сообщением об ошибке.
3. **7-дневный TTL ссылок** — `expires_at` в partnerships. Истёкшая ссылка → статус `expired`, игрок видит "ссылка истекла".
4. **Предупреждение при генерации** — "Ссылка действительна 7 дней. Приложение не несёт ответственности."

### Новая система промокодов (v3)
5. **Таблица `promo_codes` в БД** — одноразовые коды, VARCHAR(128), верхний/нижний регистр + цифры + спецсимволы.
6. **1 промокод = 1 человек глобально** — код сгорает ТОЛЬКО после генерации ссылки (не при вводе).
7. **Brute force защита** — 3 неверные попытки в час → блокировка на 1 час с предупреждением.
8. **Удалены хардкоженные коды** — WORKOUT2026, BETA100, TESTPRO больше не работают.
9. **Удалена команда /invite** — доп. приглашения переедут в Mini App.

### Smart /start меню
10. **Умный /start для завершивших онбординг:**
    - Ответственный + есть активный игрок → кнопка Mini App
    - Ответственный + есть pending ссылка → показать существующую
    - Ответственный + нет игрока/ссылки → "введите новый промокод"
    - Игрок → кнопка Mini App

### Типы промокодов (в БД)
11. **3 типа tier:** `basic` (1 игрок), `premium` (3 игрока), `upgrade` (basic→premium, для Mini App позже)

### Миграции (все применены)
- 001_initial.sql
- 002_onboarding_v2.sql
- 003_pair_link_expiry.sql — `expires_at`, статус `expired`
- 004_promo_codes_table.sql — таблица `promo_codes`, `promo_attempts`, `pending_promo_id`
- 005_promo_upgrade_type.sql — tier `upgrade`

---

## ✅ Завершено ранее

### Backend
1. **Полная структура backend** — пакеты core/, db/, api/routers/, services/fsm/, handlers/, keyboards/
2. **Config, Security, Auth** — pydantic-settings, HMAC-SHA256, JWT, FastAPI dependencies
3. **Supabase client** — async singleton
4. **REST API** — auth, users, partnerships роуты
5. **Деплой backend** — Railway (автодеплой при push)

### Frontend
1. **Vite + React + Three.js** — 3D кубы (Workout, Arsenal, Responsibility)
2. **Axios + Zustand + useAuth** — клиент, стор, хук авторизации
3. **OnboardingFlow** — компонент (нужна доработка)
4. **Деплой frontend** — Vercel: https://workout-bot-fsm.vercel.app
5. **BotFather** — Mini App URL обновлён

### Инфраструктура
1. **Supabase CLI** — установлен, подключён к проекту dlpdwmmfpzfxcelxqvlq
2. **Vercel** — Build Command: `vite build`, Root Directory: frontend
3. **Railway** — бэкенд деплой (автодеплой при push в main)

---

## 📝 Бизнес-правила (утверждены с Азизом)
- Любой кто заходит напрямую → Ответственный
- Игрок — ТОЛЬКО по пригласительной ссылке
- **1 промокод = 1 ссылка = 1 человек глобально**
- Basic: 1 игрок. Premium: 3 игрока (первая при онбординге, +2 в Mini App)
- Upgrade промокод — только в Mini App (реализовать позже)
- Ссылка живёт 7 дней, потом сгорает. Нужен новый промокод.
- Один человек может быть и Ответственным и Игроком (но Игроком только у одного)
- Фото обязательно только для Игрока, только в Mini App
- 3 неверных промокода в час → блокировка на 1 час

## 🔧 Известные проблемы фронтенда (исправить позже)
- gesture-layer блокирует pointer events кнопок онбординга
- Фото: убрать кнопку "Пропустить", добавить проверку лица

## 🛠️ Ключевые файлы
| Файл | Что делает |
|------|-----------|
| backend/handlers/onboarding.py | Хэндлеры онбординга v3 |
| backend/services/fsm/onboarding_fsm.py | FSM + промокоды из БД + brute force |
| backend/keyboards/onboarding_keyboards.py | Клавиатуры + WebApp кнопка |
| backend/db/migrations/003-005 | Миграции: TTL, promo_codes, upgrade tier |
| frontend/src/components/onboarding/OnboardingFlow.tsx | UI онбординга (нужна доработка) |

## ⚠️ ВАЖНО
- Пользователя зовут **Азиз** (не Николай)
- Supabase CLI залогинен — перед возвратом компьютера Николаю выполнить `supabase logout`
- MCP Николая отключены для экономии токенов
- Промокоды создаёт Азиз вручную через SQL: `INSERT INTO promo_codes (code, tier) VALUES ('КОД', 'basic');`

# 🏋️ ДОРОЖНАЯ КАРТА: Workout Bot

**Версия:** MVP 1.0  
**Стек:** Python (Aiogram 3) · Vite + React · Supabase PostgreSQL · XState FSM · Gemini Vision API  
**Механика:** 35-мин тренировка → камера записывает → AI (Gemini) оценивает → начисление звёзд → магазин наград  
**Роли:** Player (тренируется), Responsible (мотивирует, покупает бусты), Admin (управляет системой)

---

## 📋 ОГЛАВЛЕНИЕ

1. [ЭТАП 0: RESEARCH](#этап-0-research)
2. [ЭТАП 1: АРХИТЕКТУРА](#этап-1-архитектура)
3. [ЭТАП 2: ИНФРАСТРУКТУРА](#этап-2-инфраструктура)
4. [ЭТАП 3: BACKEND (Python + Aiogram)](#этап-3-backend)
5. [ЭТАП 4: FRONTEND (Vite + React)](#этап-4-frontend)
6. [ЭТАП 5: TELEGRAM ИНТЕГРАЦИЯ](#этап-5-telegram-интеграция)
7. [ЭТАП 6: CORE FEATURES](#этап-6-core-features)
8. [ЭТАП 7: МОНЕТИЗАЦИЯ И МОТИВАЦИЯ](#этап-7-монетизация-и-мотивация)
9. [ЭТАП 8: TESTING & QA](#этап-8-testing--qa)
10. [ЭТАП 9: PRODUCTION & MONITORING](#этап-9-production--monitoring)

---

## ЭТАП 0: RESEARCH

> Цель: понять ограничения платформы ДО написания кода

### Шаг 0.1 — Документация Telegram Mini Apps
- Прочитать: https://core.telegram.org/bots/webapps
- Разобраться: `initData`, `init()`, WebView ограничения, события (`onViewportChanged`, `onThemeChanged`)
- Записать 5 главных ограничений Mini Apps (безопасность, камера, хранение)

### Шаг 0.2 — Документация Telegram Bot API
- Прочитать: https://core.telegram.org/bots/api
- Ключевые методы: `sendMessage`, `setChatMenuButton`, `createInvoiceLink` (для Stars), `setWebhook`
- Записать 10 Bot API методов, которые понадобятся

### Шаг 0.3 — Документация @tma.js (SDK для Mini App)
- Прочитать: https://docs.telegram-mini-apps.com/
- Разобраться: `init()`, `initData`, `MainButton`, `BackButton`, `HapticFeedback`, `BiometricManager`
- Записать, как SDK инициализируется в React

### Шаг 0.4 — Gemini Vision API
- Прочитать: https://ai.google.dev/docs
- Разобраться: как отправлять видео, максимальный размер файла, лимиты запросов, формат ответа
- Тестовая отправка одного видео вручную (через curl или Python)
- Записать: стоимость запроса, максимальная длина видео, формат prompt'а

### Шаг 0.5 — Определи Scope MVP
| Функция | MVP | v1.5 | v2.0 |
|---------|-----|------|------|
| Онбординг (язык, роль, пол, фото, паринг) | ✅ | ✅ | ✅ |
| Система пар (Player ↔ Responsible) | ✅ | ✅ | ✅ |
| Тренировка 35 мин (камера + таймеры) | ✅ | ✅ | ✅ |
| AI-верификация (Gemini Vision, score 0-100) | ✅ | ✅ | ✅ |
| Звёзды (внутренняя валюта) | ✅ | ✅ | ✅ |
| Стрики (серии дней) | ✅ | ✅ | ✅ |
| Магазин Игрока (скипы, аватарки, лутбоксы) | ✅ | ✅ | ✅ |
| Панель Responsible (прогресс, пинги, бусты X2) | ✅ | ✅ | ✅ |
| Оплата (Stars + промокоды) | ✅ | ✅ | ✅ |
| Оплата криптовалютой | ❌ | ✅ | ✅ |
| Админ-панель (баны, статистика) | ✅ | ✅ | ✅ |
| Scheduler (напоминания, сброс стриков) | ✅ | ✅ | ✅ |
| Fun Facts AI (контент при дневном лимите) | ❌ | ✅ | ✅ |
| Настраиваемые уведомления Responsible | ❌ | ✅ | ✅ |
| Троллинг Ответственного (из магазина) | ❌ | ✅ | ✅ |
| Режим Хардкора | ❌ | ❌ | ✅ |

### Шаг 0.6 — User Journey Map
**Player:**
```
1. Получает ссылку/узнаёт о боте
2. /start → выбор языка → выбор роли → пол → опрос → селфи
3. Получает pairing code → отправляет Responsible
4. Ждёт, пока Responsible оплатит подписку
5. Открывает Mini App → видит рейтинг, стрик, кнопку тренировки
6. Нажимает "Начать тренировку" → подготовка инвентаря
7. 16 упражнений по 40 сек + отдых между ними
8. AI анализирует каждое упражнение → score 0-100
9. Итог: заработанные звёзды + обновлённый стрик
10. Тратит звёзды в магазине
```

**Responsible:**
```
1. Получает pairing code от Player → /start → ввод кода
2. Покупает подписку (Stars / промокод)
3. Видит дашборд: Global Score, 3-Day Score, активные бусты
4. Может отправить пинг-напоминание (раз в 6 часов)
5. Может купить бусты X2 (50 Stars / день, 300 Stars / неделя)
6. Получает уведомления о тренировках партнёра
```

**Admin:**
```
1. Открывает админ-панель → модули: Users, Content, Stats
2. Может забанить пользователя (банится вся пара)
3. Видит системную статистику
4. Контент (видео) загружается через Supabase Studio / Telegram CDN
```

---

## ЭТАП 1: АРХИТЕКТУРА

### Шаг 1.1 — Схема базы данных (Supabase PostgreSQL)

**USERS**
```
- id (PK, UUID)
- telegram_id (BIGINT, UNIQUE, NOT NULL)
- telegram_username (VARCHAR)
- first_name (VARCHAR)
- role ("player" | "responsible" | "admin")
- gender ("male" | "female")
- lang ("ru" | "uz" | "en")
- profile_photo_url (VARCHAR)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

**PARTNERSHIPS** (связь Responsible ↔ Player, один Responsible может иметь несколько Players)
```
- id (PK, UUID)
- responsible_id (FK → users.id)
- player_id (FK → users.id, UNIQUE — у Player один Responsible)
- pairing_code (VARCHAR, UNIQUE)
- status ("pending" | "active" | "blocked")
- created_at (TIMESTAMP)
```

**SUBSCRIPTIONS** (оплаченные подписки)
```
- id (PK, UUID)
- partnership_id (FK → partnerships.id)
- payment_method ("stars" | "promo" | "crypto")
- promo_code (VARCHAR, nullable)
- starts_at (TIMESTAMP)
- expires_at (TIMESTAMP)
- is_active (BOOLEAN)
```

**WORKOUT_SESSIONS** (каждая тренировка = 16 упражнений)
```
- id (PK, UUID)
- player_id (FK → users.id)
- started_at (TIMESTAMP)
- finished_at (TIMESTAMP, nullable)
- total_score (INTEGER) — сумма AI scores за 16 упражнений
- stars_earned (INTEGER) — конвертированные звёзды
- boost_multiplier (INTEGER, default 1) — 1 или 2 (если буст активен)
- status ("in_progress" | "completed" | "aborted")
```

**EXERCISE_VERDICTS** (AI-оценка каждого упражнения внутри сессии)
```
- id (PK, UUID)
- session_id (FK → workout_sessions.id)
- exercise_index (INTEGER, 0-15)
- exercise_video_url (VARCHAR, nullable)
- ai_score (INTEGER, 0-100)
- ai_raw_response (JSONB, nullable) — сырой ответ Gemini
- created_at (TIMESTAMP)
```

**PLAYER_STATS** (кэш рейтингов, обновляется после каждой тренировки)
```
- player_id (PK, FK → users.id)
- global_score (INTEGER)
- three_day_score (INTEGER)
- current_streak (INTEGER)
- best_streak (INTEGER)
- last_workout_date (DATE)
- star_balance (INTEGER) — текущий баланс звёзд
- level_window (JSONB) — [1, 2, 3] текущее окно уровней
```

**SHOP_ITEMS** (каталог товаров магазина)
```
- id (PK, UUID)
- name (VARCHAR)
- description (TEXT)
- category ("skip" | "avatar" | "lootbox" | "troll" | "hardcore")
- price_stars (INTEGER)
- is_active (BOOLEAN)
```

**PURCHASES** (покупки Игрока)
```
- id (PK, UUID)
- player_id (FK → users.id)
- item_id (FK → shop_items.id)
- purchased_at (TIMESTAMP)
```

**BOOSTS** (бусты X2 от Responsible)
```
- id (PK, UUID)
- partnership_id (FK → partnerships.id)
- boost_type ("1_day" | "1_week")
- activated_at (TIMESTAMP)
- expires_at (TIMESTAMP)
```

**EXERCISES_LIBRARY** (видеобиблиотека упражнений, управляет Admin)
```
- id (PK, UUID)
- title (VARCHAR)
- video_url (VARCHAR) — ссылка на Telegram CDN или Supabase Storage
- difficulty (INTEGER, 1-10)
- body_part (VARCHAR)
- created_at (TIMESTAMP)
```

**NOTIFICATION_SETTINGS** (настройки уведомлений Responsible)
```
- responsible_id (PK, FK → users.id)
- notify_workout_started (BOOLEAN, default TRUE)
- notify_workout_finished (BOOLEAN, default TRUE) — нельзя выключить
- notify_shop_purchase (BOOLEAN, default TRUE)
- notify_streak_lost (BOOLEAN, default TRUE)
- notify_milestone (BOOLEAN, default TRUE)
```

---

### Шаг 1.2 — API Endpoints

**AUTH**
| Метод | URL | Описание |
|-------|-----|----------|
| POST | /auth/telegram | Принять initData, валидировать, создать JWT |

**USERS**
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /users/me | Получить свой профиль |
| PUT | /users/me | Обновить профиль (роль, язык, фото) |

**PARTNERSHIPS**
| Метод | URL | Описание |
|-------|-----|----------|
| POST | /partnerships/create-code | Player генерирует pairing code |
| POST | /partnerships/accept-code | Responsible вводит код → привязка |
| GET | /partnerships/my-partner | Получить данные своего партнёра |

**WORKOUTS**
| Метод | URL | Описание |
|-------|-----|----------|
| POST | /workouts/start | Начать тренировочную сессию |
| POST | /workouts/:session_id/exercise | Отправить видео упражнения на AI |
| POST | /workouts/:session_id/finish | Завершить сессию, подсчитать звёзды |
| GET | /workouts/history | История тренировок |

**STATS**
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /stats/me | Получить свой рейтинг, стрик, баланс |
| GET | /stats/partner | Получить рейтинг партнёра (для Responsible) |

**SHOP**
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /shop/items | Каталог товаров |
| POST | /shop/purchase | Купить товар за звёзды |

**BOOSTS**
| Метод | URL | Описание |
|-------|-----|----------|
| POST | /boosts/buy | Responsible покупает буст X2 (через Stars) |
| GET | /boosts/active | Проверить активный буст |

**PAYMENTS**
| Метод | URL | Описание |
|-------|-----|----------|
| POST | /payments/promo | Проверить промокод |
| POST | /payments/stars | Инициировать оплату через Telegram Stars |

**NOTIFICATIONS**
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /notifications/settings | Получить настройки уведомлений |
| PUT | /notifications/settings | Обновить настройки |

**ADMIN**
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /admin/stats | Системная статистика |
| POST | /admin/ban/:user_id | Забанить пользователя (+ партнёра) |
| GET | /admin/users | Поиск пользователей |

---

### Шаг 1.3 — Telegram Bot команды

| Команда | Что делает | Что показывает бот |
|---------|-----------|-------------------|
| /start | Entry point. Если новый — запускает онбординг. Если есть deep link — обрабатывает invite | "Добро пожаловать! Выбери язык" или "Открой приложение" |
| /start invite_ABC123 | Deep link. Responsible вводит код партнёра | "Код принят! Оплатите подписку" |
| /help | Справка | Краткая инструкция использования |
| /menu | Открывает Mini App | Кнопка "Открыть приложение" |

**Уведомления от бота (автоматические):**
| Кому | Когда | Текст |
|------|-------|-------|
| Responsible | Player начал тренировку | "🏋️ Партнёр начал тренировку!" |
| Responsible | Player закончил тренировку | "✅ Партнёр закончил! Score: 87/100. Звёзды: +42" |
| Responsible | Player купил в магазине | "🛒 Партнёр купил: Скип тренировки" |
| Responsible | Player потерял стрик | "🔥❌ Партнёр потерял стрик 7 дней!" |
| Player | Вечернее напоминание (scheduler) | "⏰ Не забудь тренировку! Стрик: 5 дней 🔥" |
| Player | Responsible купил буст X2 | "⚡ Ваш партнёр активировал X2! Все баллы удвоены" |
| Player | Responsible отправил пинг | "💪 Партнёр верит в тебя! Давай тренироваться!" |

---

### Шаг 1.4 — Security & Auth

**Процесс аутентификации:**
```
1. Пользователь открывает Mini App через Telegram
2. Telegram SDK загружает initData (зашифрованные данные: user_id, username, hash)
3. Frontend отправляет raw initData на бэкенд: POST /auth/telegram
4. Бэкенд:
   a. Берёт TELEGRAM_BOT_TOKEN
   b. Вычисляет HMAC SHA-256 подпись
   c. Сравнивает с hash из initData
   d. Если совпало → пользователь настоящий
   e. Создаёт/обновляет пользователя в Supabase
   f. Генерирует JWT токен (подписанный JWT_SECRET)
   g. Отвечает: { token, user }
5. Frontend сохраняет токен в памяти
6. Каждый следующий запрос: Authorization: Bearer <token>
```

**Правила безопасности:**
- initData валидируется ТОЛЬКО на сервере. Никогда на фронте
- JWT_SECRET — минимум 32 символа, случайная строка
- CORS разрешён только для домена Mini App
- SQL injection: Supabase client использует параметризованные запросы
- XSS: React автоматически экранирует
- Токены НЕ в URL, только в заголовках
- .env файлы в .gitignore, никогда не в Git

---

### Шаг 1.5 — Маппинг FSM → Экраны

| FSM-машина | Экран в Mini App | Что видит пользователь |
|---|---|---|
| `000_rootMachine` | — (логика в боте) | Роутинг по ролям |
| `100_paymentMachine` | PaymentPage | Три кнопки: Stars, Промокод, (Крипто) |
| `101_onboardingMachine` | OnboardingPage | Пошаговая регистрация: язык → роль → пол → опрос → фото → код |
| `102_adminMachine` | AdminPage | Модули: Users, Content, Stats |
| `103_workoutGateMachine` | PlayerMenuPage | Рейтинг, стрик, буст, кнопка "Тренироваться", магазин |
| `104_responsibleMachine` | ResponsiblePage | Прогресс партнёра, пинг, магазин бустов |
| `105_playerShopMachine` | ShopPage | Каталог, покупка, баланс звёзд |
| `200_workoutSessionMachine` | WorkoutPage | Камера, таймер, упражнение, AI verdict |

---

## ЭТАП 2: ИНФРАСТРУКТУРА

### Шаг 2.1 — GitHub репозиторий

Репозиторий: `azizgozievuzb/Workout-Bot-FSM` (уже существует)

**Целевая структура:**
```
Workout-Bot-FSM/
├── backend/                    # Python + Aiogram
│   ├── bot/
│   │   ├── __init__.py
│   │   ├── main.py             # Точка входа
│   │   ├── handlers/           # Обработчики команд бота
│   │   ├── services/           # Бизнес-логика
│   │   ├── models/             # Pydantic модели
│   │   ├── middleware/         # Auth, error handling
│   │   └── utils/              # Утилиты
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/                   # Vite + React
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store/
│   │   ├── services/
│   │   └── types/
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── fsm_blueprints/             # XState машины (source of truth)
├── research/                   # Исследования
├── docker-compose.yml          # Для локальной разработки
├── PLAN.md
└── README.md
```

### Шаг 2.2 — Supabase

1. Зарегистрироваться на https://supabase.com
2. Создать проект
3. Записать:
   - `SUPABASE_URL` (URL проекта)
   - `SUPABASE_KEY` (anon key — для фронтенда)
   - `SUPABASE_SERVICE_KEY` (service key — для бэкенда, полный доступ)
4. Создать таблицы (см. Шаг 1.1) через Table Editor или SQL Editor
5. Настроить Storage bucket для видео (если не через Telegram CDN)

### Шаг 2.3 — Хостинг бэкенда

**Вариант A: Railway** (рекомендую)
- Деплой из GitHub в 2 клика
- Поддержка Docker
- $5/мес хватит на MVP
- Автоматический деплой при push

**Вариант B: Render**
- Бесплатный tier (медленный cold start)
- Похоже на Railway

**Выбрать один. Зарегистрироваться. Создать проект.**

### Шаг 2.4 — .env файлы

**backend/.env.example:**
```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=123456:ABC-DEF-your-token
TELEGRAM_WEBHOOK_URL=https://your-backend.railway.app/webhook

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...your-service-key

# JWT (секретный ключ для цифровых пропусков — минимум 32 символа)
JWT_SECRET=super-long-random-string-nobody-knows-32chars

# Gemini
GEMINI_API_KEY=your-gemini-api-key

# Frontend (для CORS — разрешить запросы только с этого адреса)
FRONTEND_URL=https://your-frontend.railway.app

# Environment
ENV=development
```

**frontend/.env.example:**
```env
# Backend API (адрес сервера)
VITE_API_URL=https://your-backend.railway.app

# Telegram Bot Username (для Deep Links — ссылок с параметрами)
VITE_TELEGRAM_BOT_USERNAME=YourBotName_bot
```

---

## ЭТАП 3: BACKEND

### Шаг 3.1 — Инициализация Python проекта

```bash
cd Workout-Bot-FSM/backend
python -m venv venv
source venv/bin/activate   # macOS/Linux
```

**requirements.txt:**
```
aiogram==3.x           # Фреймворк для Telegram-бота
aiohttp==3.x           # HTTP-сервер и клиент (встроен в aiogram)
python-dotenv==1.x     # Чтение .env файла с секретами
supabase==2.x          # Клиент для Supabase (вместо сырого SQL)
pydantic==2.x          # Валидация данных (вместо joi)
PyJWT==2.x             # Создание и проверка JWT токенов
google-generativeai    # Клиент Gemini Vision API
httpx==0.x             # Асинхронные HTTP запросы
APScheduler==3.x       # Планировщик задач (cron для scheduler machine)
```

**Что делает каждый пакет:**
| Пакет | Объяснение |
|-------|-----------|
| `aiogram` | Принимает сообщения из Telegram, обрабатывает кнопки, отправляет ответы |
| `aiohttp` | Веб-сервер для API endpoints (GET /stats/me, POST /auth/telegram итд.) |
| `python-dotenv` | Читает файл `.env` и загружает секреты (TOKEN, API ключи) в код |
| `supabase` | Общение с базой данных Supabase через Python (вместо написания SQL вручную) |
| `pydantic` | Проверяет, что данные правильного типа ("role должен быть player или responsible") |
| `PyJWT` | Создаёт и проверяет JWT токены (цифровые пропуска для авторизации) |
| `google-generativeai` | Отправляет видео в Gemini и получает AI-оценку (score 0-100) |
| `httpx` | Отправляет HTTP запросы к внешним API (асинхронно) |
| `APScheduler` | Запускает задачи по расписанию: "каждый день в 00:00 сбросить дневной лимит" |

### Шаг 3.2 — Структура папок backend

```
backend/
├── bot/
│   ├── __init__.py
│   ├── main.py                     # Точка входа: запуск бота + API сервера
│   ├── config.py                   # Загрузка .env, константы
│   │
│   ├── handlers/                   # 1:1 маппинг с FSM-машинами
│   │   ├── __init__.py
│   │   ├── root_handler.py         # ← 000_rootMachine
│   │   ├── onboarding_handler.py   # ← 101_onboardingMachine
│   │   ├── payment_handler.py      # ← 100_paymentMachine
│   │   ├── workout_gate_handler.py # ← 103_workoutGateMachine
│   │   ├── workout_session_handler.py # ← 200_workoutSessionMachine
│   │   ├── player_shop_handler.py  # ← 105_playerShopMachine
│   │   ├── responsible_handler.py  # ← 104_responsibleMachine
│   │   └── admin_handler.py        # ← 102_adminMachine
│   │
│   ├── services/                   # Бизнес-логика (отдельно от handlers)
│   │   ├── __init__.py
│   │   ├── auth_service.py         # Валидация initData, JWT
│   │   ├── workout_service.py      # Логика тренировки
│   │   ├── ai_service.py           # Общение с Gemini Vision
│   │   ├── shop_service.py         # Магазин, баланс
│   │   ├── stats_service.py        # Рейтинги, стрики
│   │   ├── notification_service.py # Отправка уведомлений
│   │   ├── payment_service.py      # Stars, промокоды
│   │   └── scheduler_service.py    # Cron-задачи
│   │
│   ├── models/                     # Pydantic модели (типизация данных)
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── workout.py
│   │   └── shop.py
│   │
│   ├── middleware/
│   │   ├── __init__.py
│   │   ├── auth_middleware.py      # Проверка JWT токена
│   │   └── error_handler.py        # Ловля ошибок
│   │
│   ├── api/                        # REST API endpoints (для Mini App)
│   │   ├── __init__.py
│   │   ├── auth_routes.py
│   │   ├── workout_routes.py
│   │   ├── shop_routes.py
│   │   ├── stats_routes.py
│   │   └── admin_routes.py
│   │
│   └── utils/
│       ├── __init__.py
│       ├── logger.py               # Логирование
│       └── validators.py           # Вспомогательные проверки
│
├── requirements.txt
├── Dockerfile
└── .env.example
```

**Правило:** Каждый handler = одна FSM-машина. Открываешь `workoutGateHandler.py` → рядом открываешь `103_workoutGateMachine.ts` → переводишь состояния 1:1 в Python.

### Шаг 3.3 — Dockerfile для Python

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "-m", "bot.main"]
```

**Зачем?** Railway (или любой хостинг) читает этот рецепт и запускает бота. Без Dockerfile хостинг не знает, как запустить программу.

### Шаг 3.4 — Scheduler (Cron-задачи)

Реализация `schedulerMachine` через APScheduler:

| Задача | Когда | Что делает |
|--------|-------|-----------|
| Сброс дневного лимита | Каждый день, 00:00 | Обнуляет флаг "тренировался сегодня" |
| Проверка стриков | Каждый день, 01:00 | Если вчера не тренировался → streak = 0 |
| Вечернее напоминание | Каждый день, 19:00 | Бот пишет Player'у: "Не забудь тренировку!" |
| Проверка подписок | Каждый день, 06:00 | Если подписка истекла → блокировка доступа |
| Проверка бустов | Каждый час | Если буст истёк → деактивировать |

---

## ЭТАП 4: FRONTEND

### Шаг 4.1 — Инициализация React проекта

```bash
cd Workout-Bot-FSM/frontend
npm create vite@latest . -- --template react-ts
npm install
```

**Установить зависимости:**
```bash
npm install @telegram-apps/sdk-react axios zustand react-router-dom
```

| Пакет | Что делает |
|-------|-----------|
| `@telegram-apps/sdk-react` | Мост между React и Telegram. Читает данные юзера (имя, id), управляет кнопками Telegram (MainButton, BackButton), адаптирует тему (тёмная/светлая). Без него приложение не знает, что оно внутри Telegram |
| `axios` | Почтальон. Отправляет запросы на сервер и получает ответы. `axios.post('/auth')` → залогинился. `axios.get('/stats')` → получил рейтинг |
| `zustand` | Общая память приложения. Хранит: кто залогинен, сколько звёзд, текущий экран. Все компоненты видят одни данные |
| `react-router-dom` | Навигация. URL `/workout` → экран тренировки. URL `/shop` → магазин. Кнопка "назад" → предыдущий экран |

### Шаг 4.2 — Структура папок frontend

```
frontend/src/
├── App.tsx                         # Главный компонент, роутинг
├── main.tsx                        # Точка входа
│
├── pages/                          # 1:1 маппинг с FSM-машинами
│   ├── OnboardingPage.tsx          # ← 101_onboardingMachine
│   ├── PaymentPage.tsx             # ← 100_paymentMachine
│   ├── PlayerMenuPage.tsx          # ← 103_workoutGateMachine
│   ├── WorkoutPage.tsx             # ← 200_workoutSessionMachine
│   ├── ShopPage.tsx                # ← 105_playerShopMachine
│   ├── ResponsiblePage.tsx         # ← 104_responsibleMachine
│   ├── AdminPage.tsx               # ← 102_adminMachine
│   └── NotFoundPage.tsx
│
├── components/
│   ├── Workout/
│   │   ├── Timer.tsx               # Таймер 40 сек / отдых
│   │   ├── CameraView.tsx          # Камера (запись видео)
│   │   ├── ExerciseCard.tsx        # Текущее упражнение
│   │   └── AiVerdictCard.tsx       # Показ AI score
│   ├── Stats/
│   │   ├── ScoreCard.tsx           # Рейтинг, звёзды
│   │   ├── StreakBadge.tsx         # Стрик
│   │   └── BoostIndicator.tsx     # Индикатор буста X2
│   ├── Shop/
│   │   ├── ShopItem.tsx            # Товар в магазине
│   │   └── BalanceBar.tsx          # Баланс звёзд
│   ├── Common/
│   │   ├── Button.tsx
│   │   ├── Loading.tsx
│   │   └── ErrorMessage.tsx
│   └── Telegram/
│       ├── TelegramInit.tsx        # Инициализация SDK
│       └── SafeArea.tsx            # Учёт safe area
│
├── hooks/
│   ├── useAuth.ts                  # Авторизация через initData
│   ├── useTelegram.ts              # Доступ к Telegram SDK
│   ├── useWorkout.ts               # Логика тренировки
│   ├── useCamera.ts                # Управление камерой
│   ├── useWakeLock.ts              # Экран не гаснет 35 минут
│   └── useTimer.ts                 # Умный таймер (устойчив к блокировке)
│
├── store/
│   ├── authStore.ts                # Zustand: кто залогинен, JWT
│   ├── workoutStore.ts             # Zustand: текущая сессия
│   └── statsStore.ts               # Zustand: рейтинг, стрик, баланс
│
├── services/
│   ├── api.ts                      # Axios instance + JWT interceptor
│   └── telegramService.ts          # Обёртка над Telegram SDK
│
├── styles/
│   └── globals.css                 # Глобальные стили
│
└── types/
    ├── index.ts                    # Общие типы
    └── telegram.ts                 # Типы Telegram
```

### Шаг 4.3 — Инициализация Telegram SDK

```tsx
// components/Telegram/TelegramInit.tsx
// Этот компонент оборачивает всё приложение
// Вызывает SDK.init() и получает данные юзера
```

**Критично:** init() вызывается ДО любого использования SDK. Без этого — ошибки.

### Шаг 4.4 — Камера и видеозапись

**Самый сложный компонент фронтенда.** Должен:
1. Открывать фронтальную камеру через `navigator.mediaDevices.getUserMedia`
2. Записывать видео 40 секунд (один подход)
3. Нарезать на chunk'и через `MediaRecorder`
4. Хранить chunk'и локально до "коммита" (пользователь нажал "далее")
5. Загружать видео на сервер для AI-анализа

**WakeLock** (экран не гаснет):
```tsx
// hooks/useWakeLock.ts
// navigator.wakeLock.request('screen')
// Уже исследовано: PLAN.md → SUCCESS
```

**Умный таймер** (не зависит от блокировки экрана):
```tsx
// hooks/useTimer.ts
// Использует performance.now() или Date.now(), не setInterval
// Уже исследовано: PLAN.md → SUCCESS
```

### Шаг 4.5 — API service

```tsx
// services/api.ts
// axios.create + baseURL + JWT interceptor
// Каждый запрос автоматически включает Authorization: Bearer <token>
// При 401 ошибке — перелогинивание
```

---

## ЭТАП 5: TELEGRAM ИНТЕГРАЦИЯ

### Шаг 5.1 — Создать бота в BotFather
1. В Telegram → @BotFather → `/newbot`
2. Сохранить TOKEN в `.env`

### Шаг 5.2 — Зарегистрировать Mini App
1. @BotFather → `/newapp`
2. Указать URL фронтенда (после деплоя)

### Шаг 5.3 — Настроить Menu Button
1. @BotFather → `/setmenubutton`
2. Указать "Открыть приложение" → URL Mini App

### Шаг 5.4 — Валидация initData (Python)

```python
# services/auth_service.py
# 1. Берём BOT_TOKEN
# 2. Вычисляем HMAC SHA-256
# 3. Сравниваем с hash из initData
# 4. Если OK → парсим user_id, first_name
# КРИТИЧЕСКИ ВАЖНО. Без этого = взлом.
```

### Шаг 5.5 — Webhook

Aiogram 3 имеет встроенную поддержку webhook'ов. Настройка:
```python
# main.py
# dp = Dispatcher()
# app = web.Application()
# webhook_handler = SimpleRequestHandler(dispatcher=dp, bot=bot)
# webhook_handler.register(app, path="/webhook")
```

### Шаг 5.6 — Регистрация webhook

После деплоя бэкенда:
```bash
curl -X POST https://api.telegram.org/bot{TOKEN}/setWebhook \
  -d url=https://your-backend.railway.app/webhook
```

---

## ЭТАП 6: CORE FEATURES

### Шаг 6.1 — Auth (авторизация)
- FSM: `000_rootMachine` → `checkingProfile`
- Frontend: отправляет initData → получает JWT → сохраняет в zustand
- Backend: валидирует initData → создаёт/находит юзера → выдаёт JWT

### Шаг 6.2 — Онбординг
- FSM: `101_onboardingMachine`
- Шаги: Язык → Роль → Пол → Опрос (для Player) → Фото → Pairing code
- Player создаёт код → отправляет Responsible
- Responsible вводит код → привязка

### Шаг 6.3 — Оплата подписки
- FSM: `100_paymentMachine`
- Три способа: Telegram Stars, Промокод, (позже Крипто)
- После оплаты → Player получает доступ к тренировкам

### Шаг 6.4 — Workout Gate (раздевалка)
- FSM: `103_workoutGateMachine`
- Показ: Global Score, 3-Day Score, текущий уровень, активный буст
- Кнопки: "Тренироваться", "Магазин", "Назад"
- Проверка инвентаря → запуск тренировки

### Шаг 6.5 — Тренировочная сессия
- FSM: `200_workoutSessionMachine`
- Цикл 16 упражнений:
  1. Подготовка (5 сек)
  2. Упражнение (40 сек) — камера записывает
  3. Отдых + AI анализ (параллельно)
  4. Показ AI Verdict (score 0-100)
  5. Следующее упражнение / Финиш
- Итог: суммарный score → конвертация в звёзды

### Шаг 6.6 — AI Pipeline (Gemini Vision)
- Видео упражнения (40 сек) → загрузка на сервер
- Сервер отправляет видео в Gemini Vision API
- Prompt: "Оцени качество выполнения упражнения [название] от 0 до 100"
- Gemini возвращает score → сохранение в `exercise_verdicts`
- Если Gemini недоступен → score = 0, сообщение об ошибке

### Шаг 6.7 — Панель Responsible
- FSM: `104_responsibleMachine`
- Дашборд: Global Score партнёра, 3-Day Score, активный буст
- Пинг-напоминание (раз в 6 часов)
- Магазин бустов X2: день = 50 Stars, неделя = 300 Stars

### Шаг 6.8 — Магазин Игрока
- FSM: `105_playerShopMachine`
- Каталог товаров (из таблицы `shop_items`)
- Покупка за звёзды → проверка баланса → списание

### Шаг 6.9 — Админ-панель
- FSM: `102_adminMachine`
- Модули: Users (поиск + бан), Content (инфо о загрузке видео), Stats (статистика)
- Бан: банится вся пара (Player + Responsible)

---

## ЭТАП 7: МОНЕТИЗАЦИЯ И МОТИВАЦИЯ

### Шаг 7.1 — Система звёзд (Stars)
- AI Score (0-100) за каждое упражнение
- 16 упражнений × score = суммарный score сессии
- Суммарный score конвертируется в "Тренировочное Золото" (звёзды)
- Если активен буст X2 → звёзды × 2
- Звёзды = валюта магазина

### Шаг 7.2 — Стрики (Streaks)
- Каждый день тренировка → streak +1
- Пропустил день → streak = 0
- Best streak сохраняется навсегда
- Scheduler проверяет каждый день в 01:00

### Шаг 7.3 — Уведомления (настраиваемые для Responsible)
**Настройки через бота или Mini App:**

| Уведомление | По умолчанию | Можно выключить? |
|---|---|---|
| Партнёр начал тренировку | ВКЛ | ✅ Да |
| Партнёр закончил тренировку (+ score) | ВКЛ | ❌ Нет (главное) |
| Партнёр купил в магазине | ВКЛ | ✅ Да |
| Партнёр потерял стрик | ВКЛ | ✅ Да |
| Партнёр достиг milestone | ВКЛ | ✅ Да |

### Шаг 7.4 — Бусты X2 (Responsible покупает)
- Responsible покупает буст через Telegram Stars
- День X2 = 50 Stars
- Неделя X2 = 300 Stars
- Все звёзды Player'а удвоены на период буста

---

## ЭТАП 8: TESTING & QA

### Шаг 8.1 — Test план

**Auth:**
- [ ] Логин через initData работает
- [ ] Невалидная initData → ошибка 401
- [ ] JWT токен создаётся и проверяется

**Онбординг:**
- [ ] Полный цикл: язык → роль → пол → опрос → фото → код
- [ ] Player создаёт код, Responsible вводит код
- [ ] Привязка пары работает
- [ ] Повторный вход → пропуск онбординга

**Оплата:**
- [ ] Telegram Stars работают
- [ ] Промокод валидируется
- [ ] Истечение подписки → блокировка

**Тренировка:**
- [ ] Камера открывается в Mini App
- [ ] WakeLock работает (экран не гаснет 35 мин)
- [ ] Таймер точный (не сбивается при блокировке)
- [ ] Видео записывается и отправляется
- [ ] AI возвращает score 0-100
- [ ] Звёзды начисляются правильно
- [ ] Буст X2 удваивает звёзды

**Магазин:**
- [ ] Список товаров отображается
- [ ] Покупка за звёзды → списание баланса
- [ ] Недостаточно средств → ошибка

**Responsible:**
- [ ] Дашборд показывает актуальные данные
- [ ] Пинг работает (и кулдаун 6 часов)
- [ ] Буст X2 покупается и активируется
- [ ] Уведомления приходят в Telegram

**Scheduler:**
- [ ] Стрик сбрасывается в 01:00 если не тренировался
- [ ] Вечернее напоминание в 19:00
- [ ] Истёкший буст деактивируется

### Шаг 8.2 — Инструменты

```bash
# Backend (Python)
pip install pytest pytest-asyncio

# Frontend (React)
npm install -D vitest @testing-library/react
```

### Шаг 8.3 — Безопасность

- [ ] initData валидируется на сервере
- [ ] JWT в заголовках, не в URL
- [ ] CORS только для домена Mini App
- [ ] SQL injection невозможна (Supabase client)
- [ ] .env не в Git
- [ ] Секреты не в логах

---

## ЭТАП 9: PRODUCTION & MONITORING

### Шаг 9.1 — Docker setup

**docker-compose.yml** (для локальной разработки):
```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    env_file: ./backend/.env
    
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    env_file: ./frontend/.env
```

### Шаг 9.2 — Деплой на хостинг

1. Push код в GitHub
2. Подключить репозиторий к Railway/Render
3. Настроить env variables в дашборде хостинга
4. Авто-деплой при каждом push

### Шаг 9.3 — Webhook в Telegram

```bash
# После деплоя:
curl -X POST https://api.telegram.org/bot{TOKEN}/setWebhook \
  -d url=https://your-backend-url/webhook

# Проверка:
curl https://api.telegram.org/bot{TOKEN}/getWebhookInfo
```

### Шаг 9.4 — Мониторинг

```bash
# Backend (Python)
pip install sentry-sdk

# Frontend (React)
npm install @sentry/react
```

### Шаг 9.5 — Deployment Checklist

Перед каждым деплоем:
- [ ] Все тесты проходят
- [ ] Нет ошибок в логах
- [ ] Все env переменные заполнены
- [ ] Миграции БД применены
- [ ] Webhook зарегистрирован
- [ ] E2E сценарий работает в Telegram

---

## 📊 ТАЙМЛАЙН

```
ЭТАП 0: RESEARCH ............ 2-3 дня
ЭТАП 1: АРХИТЕКТУРА ......... 1-2 дня
ЭТАП 2: ИНФРАСТРУКТУРА ...... 1 день
ЭТАП 3: BACKEND ............. 5-7 дней
ЭТАП 4: FRONTEND ............ 5-7 дней
ЭТАП 5: TELEGRAM ............ 1 день
ЭТАП 6: CORE FEATURES ....... 7-10 дней
ЭТАП 7: МОНЕТИЗАЦИЯ ......... 3-4 дня
ЭТАП 8: TESTING ............. 3-5 дней
ЭТАП 9: PRODUCTION .......... 1-2 дня

ИТОГО: 4-6 недель до MVP
```

---

## 🚨 КРИТИЧЕСКИЕ ПРАВИЛА

1. **initData валидация на сервере** — без этого любой может притвориться другим
2. **FSM = Source of Truth** — каждый handler в Python должен зеркалить XState-машину
3. **AI Pipeline = ядро проекта** — без Gemini это обычный трекер, не AI-платформа
4. **WakeLock + умный таймер** — без них 35-мин тренировка сломается
5. **Тестирование в реальном Telegram** — WebView ведёт себя иначе, чем браузер
6. **Никаких секретов в Git** — только `.env.example` с пустыми полями

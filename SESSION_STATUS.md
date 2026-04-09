# 📂 SESSION_STATUS.md — Текущий статус и передача смены

> **AI-агент:** Прочитай этот файл ПОСЛЕ `CLAUDE.md`. Здесь написано, на чём остановился предыдущий агент.

**Последнее обновление:** 2026-04-09  
**Последний агент:** Cowork (Claude Sonnet 4.6)

---

## 🎯 Текущий фокус
Вертикальный срез Onboarding. Backend полностью написан. Осталось: Frontend Onboarding UI + E2E тест.

## ✅ Завершено в этой сессии (Backend Vertical Slice)

1. **Структура backend** — создана полная иерархия пакетов (`core/`, `db/`, `api/routers/`, `services/fsm/`, `handlers/`, `keyboards/`)
2. **Config** — `core/config.py` через pydantic-settings, все секреты из `.env`
3. **Security** — `core/security.py`: валидация initData (HMAC-SHA256) + JWT create/decode
4. **Auth dependency** — `core/deps.py`: `get_current_user()` FastAPI dependency
5. **Supabase client** — `db/client.py`: async singleton
6. **SQL миграции** — `db/migrations/001_initial.sql`: таблицы users, partnerships, subscriptions, player_stats + RLS + triggers
7. **Реальная FSM** — `services/fsm/onboarding_fsm.py`: `OnboardingFSM` (1:1 маппинг XState) + `OnboardingService` (работа с Supabase)
8. **Handlers (полные)** — `handlers/onboarding.py`: /start, lang, role, gender, survey, photo, pairing code input
9. **Keyboards** — `keyboards/onboarding_keyboards.py`: lang, role, gender, survey, pairing_code
10. **REST API** — `api/routers/auth.py` (`POST /auth/telegram`), `users.py` (`GET /users/me`), `partnerships.py` (create-code, accept-code, my-partner)
11. **main.py** — Aiogram 3 webhook + FastAPI в одном процессе
12. **Dockerfile + railway.toml** — готово к деплою
13. **.env.example** — шаблон переменных окружения

## 🛠️ Ключевые файлы
| Файл | Что делает |
|------|-----------|
| `backend/main.py` | Точка входа: бот + REST API |
| `backend/core/config.py` | Все env-переменные |
| `backend/core/security.py` | initData валидация + JWT |
| `backend/db/migrations/001_initial.sql` | Схема БД для Supabase |
| `backend/services/fsm/onboarding_fsm.py` | Реальная FSM + OnboardingService |
| `backend/handlers/onboarding.py` | Telegram bot handlers |
| `backend/api/routers/auth.py` | POST /auth/telegram |
| `backend/api/routers/partnerships.py` | Pairing endpoints |
| `backend/requirements.txt` | Python зависимости |
| `Dockerfile` + `railway.toml` | Deploy config |
| `.env.example` | Шаблон секретов |

## 🚀 Следующие задачи
1. **Frontend Onboarding UI** — React компоненты для 6 шагов онбординга поверх существующего дизайна (`App.tsx` → `OnboardingFlow.tsx`)
2. **Axios + JWT** — `frontend/src/api/client.ts` с interceptor, `useAuth` hook
3. **E2E тест** — задеплоить на Railway, вбить реальный BOT_TOKEN, протестировать в Telegram WebView

## 📝 Инструкция для СЛЕДУЮЩЕГО AI
1. Backend готов. НЕ трогать без причины.
2. **Начинать с Frontend**: создать `frontend/src/api/client.ts`, `frontend/src/hooks/useAuth.ts`, `frontend/src/components/onboarding/OnboardingFlow.tsx`
3. Стиль — Vanilla CSS (glassmorphism из App.css), НЕ Tailwind.
4. Онбординг должен рендериться поверх существующего 3D backdrop (через `layoutMode`).
5. После фронта — Railway деплой + E2E.

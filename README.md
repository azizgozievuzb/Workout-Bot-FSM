# 🏋️ Gamified Workout Mini App — FSM Blueprints

Архитектурные чертежи (XState / Stately Studio) для Telegram Mini App тренировок с геймификацией.

> **AI-агент:** Не читай этот файл для контекста. Иди в `CLAUDE.md` → `SESSION_STATUS.md`.

## Модули (8 FSM-машин)

| Файл | Назначение |
|------|-----------|
| `000_rootMachine.ts` | Роутер ролей: Player / Responsible / Admin |
| `100_paymentMachine.ts` | Оплата: Telegram Stars (+купоны-скидки) |
| `101_onboardingMachine.ts` | Регистрация: язык → роль → пол → опрос → фото → связка пар |
| `102_adminMachine.ts` | Админ: Users (баны), Content (инфо), Stats (статистика) |
| `103_workoutGateMachine.ts` | Раздевалка: рейтинг, расписание, → тренировка или магазин |
| `104_responsibleMachine.ts` | Панель наставника: Action/Market, профиль⇄полка игрока, дарение |
| `105_playerShopMachine.ts` | Магазин Игрока: витрина, полка наставника, «Мои покупки», фото-карточка |
| `200_workoutSessionMachine.ts` | Тренировка: 16 упражнений × 40 сек, камера, AI verdict |

## Роли
- **Player** — Тренируется, записывает видео, зарабатывает капли 💧, тратит в магазине
- **Responsible** — Наставник: ведёт полку видео-обещаний, дарит капли/заморозки; единственный, кто платит реальные деньги (Stars)
- **Admin** — Управляет пользователями (баны), контентом (видеобиблиотека), статистикой

## Стек
- **Backend**: Python 3.11 + FastAPI + Aiogram 3
- **Frontend (Mini App)**: Vite + React + TypeScript
- **БД**: Supabase PostgreSQL
- **AI**: Google Gemini Vision API
- **Хостинг**: Railway

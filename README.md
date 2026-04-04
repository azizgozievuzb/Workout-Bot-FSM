# 🏋️ Gamified Workout Mini App — FSM Blueprints

Архитектурные чертежи (XState / Stately Studio) для Telegram Mini App тренировок с геймификацией.

> **AI-агент:** Не читай этот файл для контекста. Иди в `CLAUDE.md` → `SESSION_STATUS.md`.

## Модули (8 FSM-машин)

| Файл | Назначение |
|------|-----------|
| `000_rootMachine.ts` | Роутер ролей: Player / Responsible / Admin |
| `100_paymentMachine.ts` | Оплата: Telegram Stars, Промокоды, (Крипто) |
| `101_onboardingMachine.ts` | Регистрация: язык → роль → пол → опрос → фото → связка пар |
| `102_adminMachine.ts` | Админ: Users (баны), Content (инфо), Stats (статистика) |
| `103_workoutGateMachine.ts` | Раздевалка: рейтинг, бусты, → тренировка или магазин |
| `104_responsibleMachine.ts` | Панель Responsible: прогресс партнёра, пинги, бусты X2 |
| `105_playerShopMachine.ts` | Магазин Игрока: скипы, аватарки, лутбоксы, троллинг |
| `200_workoutSessionMachine.ts` | Тренировка: 16 упражнений × 40 сек, камера, AI verdict |

## Роли
- **Player** — Тренируется, записывает видео, зарабатывает звёзды, тратит в магазине
- **Responsible** — Видит прогресс партнёра, покупает бусты X2 за Telegram Stars, отправляет пинги
- **Admin** — Управляет пользователями (баны), контентом (видеобиблиотека), статистикой

## Стек
- **Backend**: Python 3.11 + Aiogram 3
- **Frontend (Mini App)**: Vite + React + TypeScript
- **БД**: Supabase PostgreSQL
- **AI**: Google Gemini Vision API
- **Хостинг**: Railway

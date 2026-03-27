# 🏋️ Gamified Workout Mini App — FSM Blueprints

Архитектурные чертежи (XState / Stately Studio) для Telegram Mini App тренировок с геймификацией.

## Модули (7 FSM-машин)

| Файл | Назначение |
|------|-----------|
| `rootMachine.ts` | Роутинг 3 ролей: Player / Responsible / Admin |
| `onboardingMachine.ts` | Регистрация, роли, ласковые имена, связка пар |
| `workoutMachine.ts` | 35-мин тренировка (оффлайн, без пауз, ИИ-вердикт) |
| `shopMachine.ts` | Магазин: покупка за ⭐️, разблокировка за 🔥 стрики |
| `responsibleMachine.ts` | Экран "Ответственного": подарки, прогресс партнера |
| `adminMachine.ts` | Суперадмин: видео-слоты, управление парами |
| `schedulerMachine.ts` | Планировщик: напоминания, сброс стриков в 00:00 |

## Роли
- **Player** — Тренируется, зарабатывает звезды, покупает подарки
- **Responsible** — Пополняет магазин подарками, видит прогресс партнера (24ч задержка)
- **Admin** — Управляет видео-библиотекой и доступом пар

## Стек (планируемый)
- **Backend**: Python 3.11 + Aiogram 3.x
- **Frontend (Mini App)**: Vite + React
- **БД**: Supabase (PostgreSQL)
- **Кэш/FSM**: Upstash Redis
- **ИИ**: Google Gemini API
- **Хостинг**: Railway + Vercel

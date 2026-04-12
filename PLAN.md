# 🗺️ План реализации (Roadmap)

Этот документ — наша «северная звезда». Здесь расписаны этапы сборки проекта от исследований до запуска.

> Детальная дорожная карта со схемой БД, API, структурой папок → `ROADMAP.md`

## Этап 0: Research (Исследования) ⏳
- [x] Проверка камеры (iPhone / Safari / TMA) — **SUCCESS**
- [x] WakeLock (негаснущий экран) — **SUCCESS**
- [x] "Умный таймер" (не боится блокировки экрана) — **SUCCESS**
- [ ] Оценка качества видео (1080p vs 480p) для Gemini Vision.
- [ ] Тестовая загрузка 28 минут видео (16 кусков) на сервер.
- [ ] Схема оплаты (через сколько запросов к Gemini наступит окупаемость).

## Этап 1: FSM-Логика (Stately Studio) 📐
- [x] **Стандарт:** Обязательно использовать цвета (`@statelyai.color`) во всех схемах.

Проектирование логики — **8 FSM-машин** (файлы в `/fsm_blueprints/`):

| # | Файл | Машина | Статус |
|---|------|--------|--------|
| 1 | `000_rootMachine.ts` | Роутер ролей | ✅ Готово |
| 2 | `100_paymentMachine.ts` | Оплата (Stars, промо, крипто) | ✅ Готово |
| 3 | `101_onboardingMachine.ts` | Онбординг + связка пар | ✅ Готово |
| 4 | `102_adminMachine.ts` | Админ-панель | ✅ Готово |
| 5 | `103_workoutGateMachine.ts` | Раздевалка (пред-тренировка) | ✅ Готово |
| 6 | `104_responsibleMachine.ts` | Панель Responsible | ✅ Готово |
| 7 | `105_playerShopMachine.ts` | Магазин Игрока | ✅ Готово |
| 8 | `200_workoutSessionMachine.ts` | Тренировка (16 упр × 40 сек) | ✅ Готово |

> **Примечание:** schedulerMachine реализуется не как XState-машина, а как набор cron-задач в APScheduler на бэкенде (см. ROADMAP.md, Шаг 3.4).

## Этап 2: Инфраструктура 🏗
- [x] Создать структуру папок `backend/` и `frontend/`.
- [x] Настроить Supabase (проект, таблицы, Storage).
- [x] Создать `.env.example` файлы.
- [x] Настроить хостинг (Railway + Vercel).

## Этап 3: Backend (Python + Aiogram) 🐍
- [x] Настройка Supabase PostgreSQL (миграции 001-010).
- [ ] Реализация API для приёма видео от Mini App.
- [x] Интеграция с Gemini Vision API (AI-стилизация фото).
- [x] Onboarding handler (промокод → язык → пол → имя → PAIR-ссылка).
- [x] Промокод-система v2 (code_type: responsible/player/admin, deep link, admin endpoints).
- [x] Dual-role система (primary_role + has_player_access + has_responsible_access).
- [x] Activity Feed API (GET /feed, POST /feed/read, GET /feed/unread-count).
- [ ] Scheduler (APScheduler): стрики, напоминания, подписки.
- [ ] Видео-анализ тренировки через Gemini Vision.

## Этап 4: Frontend (Vite + React) ⚛️
- [x] Инициализация Telegram SDK + 3D chaos mode (Three.js кубы/овалы).
- [x] Тёмная/светлая тема + gesture layer (long press, swipe).
- [x] Онбординг: промокод → поздравление → фото → приложение.
- [x] 3 куба: ActionCube, MarketCube, BondCube (UI-скелеты с мок-данными).
- [x] Dual-role система: toggle P/R, Gravity Collapse / Supernova анимации.
- [x] Свайп-карусель между кубами в fullscreen.
- [x] Dashboard (статический режим) на весь экран с dropdown меню.
- [x] PromoCodeModal для разблокировки второй роли.
- [x] Invite-блок в ActionCube (промокод + deep link для приглашения игрока).
- [ ] **Admin Cube** — 4-й куб для админа (создание промокодов, управление).
- [ ] API-подключение — заменить мок-данные реальными запросами.
- [ ] Интерфейс тренировки (камера + таймеры + WakeLock).
- [ ] Магазин ответственного (подарки для игрока).
- [ ] Экран результатов (AI score, звёзды, стрик).

## Этап 5: Testing & Production 🚀
- [x] Smoke-тесты dual-role (backend + frontend, 29/29 passed).
- [ ] Unit-тесты для cube-компонентов.
- [x] E2E тест в реальном Telegram (онбординг + промокод + кубы).
- [x] Деплой на Railway (backend) + Vercel (frontend).
- [ ] Webhook + мониторинг (Sentry).

---

> [!TIP]
> Мы постепенно идем по этому списку. Когда какой-то пункт выполнен — ставим `[x]`.
> Детали каждого шага → `ROADMAP.md`.

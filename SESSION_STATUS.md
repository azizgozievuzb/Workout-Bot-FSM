# 📂 SESSION_STATUS.md — Текущий статус и передача смены

> **AI-агент:** Прочитай этот файл ПОСЛЕ `CLAUDE.md`. Здесь написано, на чём остановился предыдущий агент.

**Последнее обновление:** 2026-04-11 (поздний вечер)
**Последний агент:** Cowork (Claude Opus 4.6)

---

## 🎯 Текущий фокус
Mini App РАБОТАЕТ. Авторизация починена. 3D кубы видны. Онбординг бота работает. Деплой Railway + Vercel настроен.

## 🚀 СЛЕДУЮЩАЯ ЗАДАЧА — Персональное фото как фон Mini App

### Требования (утверждены с Азизом):
1. **При первом открытии Mini App** (и для Ответственного, и для Игрока) — показать экран запроса селфи. Кубы НЕ показываются пока нет фото.
2. **Фото обязательно** — нет кнопки "Пропустить". Без фото Mini App не раскрывается.
3. **Фото = персональный фон** — заменяет стоковые `woman_cosmic.png` / `woman_meditating.png`. Кубы летают поверх СОБСТВЕННОГО лица пользователя.
4. **Фото сохраняется** — при следующем входе фон уже загружен, фото повторно не запрашивается.
5. **Смена темы** — удержание + свайп вверх пока НЕ работает (известный баг). Нужно исправить.

### Техническая реализация (план):
- **Frontend:** Новый компонент `PhotoGate` — показывается ДО 3D сцены если `user.photo_url` отсутствует
- **Frontend:** `Backdrop.tsx` — вместо стокового изображения загружать `user.photo_url`
- **Backend:** API endpoint `PUT /users/me/photo` — загрузка фото (Supabase Storage)
- **Backend:** API endpoint `GET /users/me` — должен возвращать `photo_url`
- **DB:** Поле `photo_url` в таблице `users` (если нет — добавить миграцию)
- **Supabase Storage:** Бакет для аватаров

### Ключевые файлы для этой задачи:
| Файл | Что менять |
|------|-----------|
| frontend/src/App.tsx | Добавить PhotoGate перед Backdrop |
| frontend/src/design/backdrop/Backdrop.tsx | Загружать user.photo_url вместо стока |
| frontend/src/components/onboarding/OnboardingFlow.tsx | Сейчас survey+photo для игрока — фото нужно для ВСЕХ |
| frontend/src/hooks/useAuth.ts | Возвращать photo_url из стора |
| backend/api/routers/users.py | Endpoint загрузки фото |

---

## ✅ Завершено за 2026-04-11 (полная сессия)

### Инфраструктура и авторизация
1. **Починена авторизация Mini App** — добавлен `telegram-web-app.js` в index.html, `Telegram.WebApp.ready()` + `expand()`, robust getInitData()
2. **VITE_API_URL** — настроен в Vercel (`https://workout-bot-fsm-production-0e08.up.railway.app`)
3. **MINI_APP_URL** — настроен в Railway (`https://workout-bot-fsm.vercel.app`) для CORS
4. **Vercel домен добавлен в CORS** явно в backend

### Фронтенд
5. **Убран мокап телефона** — Mini App на полный экран (100% × 100vh)
6. **Убран дублирующий онбординг** — Ответственный → сразу 3D кубы, Игрок → только Survey + Photo
7. **3D кубы видимые** — исправлен z-index backdrop-stage (было -10, стало 0), app-container transparent
8. **Десктоп Telegram** — "Откройте приложение с телефона" (корректное сообщение)
9. **Дебаг ошибок авторизации** — реальная ошибка показывается на экране

### Бот (backend)
10. **Кнопка "Открыть приложение" сразу после ссылки** — без повторного /start
11. **Ссылка в `<code>` блоке** — нажал = скопировал. Кнопка "Поделиться" (switch_inline_query)
12. **Предупреждения** — одноразовость, 7 дней TTL, невозможность отката
13. **Промокоды v3** — из БД, brute force защита, типы basic/premium/upgrade
14. **Smart /start** — разное поведение по состоянию пользователя

### Миграции (все применены)
- 001-005 (initial, onboarding_v2, pair_link_expiry, promo_codes, upgrade_type)

---

## 📝 Бизнес-правила (утверждены с Азизом)
- Любой кто заходит напрямую → Ответственный
- Игрок — ТОЛЬКО по пригласительной ссылке
- **1 промокод = 1 ссылка = 1 человек глобально**
- Basic: 1 игрок. Premium: 3 игрока (первая при онбординге, +2 в Mini App)
- Upgrade промокод — только в Mini App (реализовать позже)
- Ссылка живёт 7 дней, потом сгорает. Нужен новый промокод.
- Один человек может быть и Ответственным и Игроком (но Игроком только у одного)
- **Фото обязательно для ВСЕХ пользователей** в Mini App (не только Игрок)
- 3 неверных промокода в час → блокировка на 1 час

## 🔧 Известные баги
- Свайп вверх при удержании не меняет тему (dark↔light)
- gesture-layer может ловить touch при открытии Mini App
- `@telegram-apps/sdk-react` deprecated → нужно мигрировать на `@tma.js`

## 🛠️ Ключевые файлы
| Файл | Что делает |
|------|-----------|
| backend/handlers/onboarding.py | Хэндлеры онбординга v3 |
| backend/services/fsm/onboarding_fsm.py | FSM + промокоды из БД + brute force |
| backend/keyboards/onboarding_keyboards.py | Клавиатуры + WebApp кнопка |
| frontend/src/App.tsx | Главный компонент, gesture handling |
| frontend/src/hooks/useAuth.ts | Авторизация через Telegram initData |
| frontend/src/design/backdrop/Backdrop.tsx | 3D сцена: лицо + частицы + кубы |
| frontend/src/design/backdrop/GlassCubes.tsx | 3D кубы (canvas, hit detection) |
| frontend/src/components/onboarding/OnboardingFlow.tsx | Survey + Photo для игрока |

## ⚠️ ВАЖНО
- Пользователя зовут **Азиз** (не Николай)
- Supabase CLI залогинен — перед возвратом компьютера Николаю выполнить `supabase logout`
- Промокоды создаёт Азиз вручную через SQL: `INSERT INTO promo_codes (code, tier) VALUES ('КОД', 'basic');`
- **Vercel env:** `VITE_API_URL=https://workout-bot-fsm-production-0e08.up.railway.app`
- **Railway env:** `MINI_APP_URL=https://workout-bot-fsm.vercel.app`

## 🗃️ SQL для сброса тестовых данных
```sql
DELETE FROM partnerships;
UPDATE users SET onboarding_state = NULL, onboarding_done = false, pending_promo_id = NULL, promo_attempts = 0, promo_locked_until = NULL;
UPDATE promo_codes SET is_used = false, used_by = NULL, used_at = NULL;
```

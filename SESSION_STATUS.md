# SESSION_STATUS.md — Текущий статус и передача смены

> **AI-агент:** Прочитай этот файл ПОСЛЕ `CLAUDE.md`. Здесь написано, на чём остановился предыдущий агент.

**Последнее обновление:** 2026-04-11 (ночь)
**Последний агент:** Cowork (Claude Opus 4.6)

---

## СЛЕДУЮЩАЯ ЗАДАЧА — AI-стилизация селфи

**Полная инструкция:** `PROMPT_AI_PHOTO.md` — скопируй в новую сессию Claude Code.

### Что нужно:
- После загрузки селфи → Gemini API генерирует 2 стилизованные версии:
  - **Dark:** космический стиль (James Webb, nebulae, галактический glow)
  - **Light:** медитативный стиль (закрытые глаза, мягкий свет, ethereal)
- Обработка в фоне (`asyncio.create_task`) пока пользователь проходит онбординг
- Онбординг идёт МЕДЛЕННО (маскирует время обработки 10-30 сек)
- Backdrop выбирает dark/light версию по текущей теме

### Что уже сделано:
- PhotoGate работает: камера → овал → face detection → обратный отсчёт → захват → загрузка в Supabase Storage
- `POST /users/me/photo` загружает оригинал в Storage и сохраняет URL в БД
- Auth response возвращает `profile_photo_url`
- Backdrop использует персональное фото вместо стоковых
- Смена темы (hold + swipe up) починена
- gesture-layer не перехватывает тачи при открытых оверлеях

### Что нужно создать/изменить (12 шагов):
1. Миграция `006_photo_styles.sql` (photo_dark_url, photo_light_url, photo_processing)
2. GEMINI_API_KEY в config.py
3. `backend/services/photo_styler.py` — сервис стилизации
4. Фоновая задача в upload_photo
5. Endpoint `/users/me/photo-status`
6. photo_dark_url + photo_light_url в auth response
7. authStore — новые поля
8. useAuth — передача новых полей
9. Backdrop — dark/light фото по теме
10. Поллинг статуса обработки
11. Онбординг с плавным темпом + ожидание обработки
12. TypeScript проверка

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
- GEMINI_API_KEY — `AIzaSyDkXkF3d7OrTA31n8tZMc8Q44xm3qOQ7ls`

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
- **Railway env (добавить):** `GEMINI_API_KEY=AIzaSyDkXkF3d7OrTA31n8tZMc8Q44xm3qOQ7ls`

## SQL для сброса тестовых данных
```sql
DELETE FROM partnerships;
UPDATE users SET onboarding_state = NULL, onboarding_done = false, pending_promo_id = NULL, promo_attempts = 0, promo_locked_until = NULL, profile_photo_url = NULL, photo_dark_url = NULL, photo_light_url = NULL, photo_processing = false;
UPDATE promo_codes SET is_used = false, used_by = NULL, used_at = NULL;
```

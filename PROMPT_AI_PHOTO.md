# PROMPT: AI-стилизация селфи (Gemini Imagen)

> Скопируй этот промпт целиком в новую сессию Claude Code.

---

## Контекст
Прочитай `CLAUDE.md` и `SESSION_STATUS.md`. Проект — Telegram Mini App (Workout Bot). 

Сейчас работает PhotoGate — пользователь делает селфи, оно загружается в Supabase Storage (бакет `avatars`) и используется как фон Mini App. 

**Нужно:** после загрузки оригинала — обработать фото через Gemini API и создать 2 стилизованные версии лица (овал). Обработка идёт в фоне пока пользователь проходит онбординг.

---

## Задача (пошагово)

### 1. Миграция БД (006)
Создай файл `backend/db/migrations/006_photo_styles.sql`:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_dark_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_light_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_processing BOOLEAN DEFAULT FALSE;
```
Скажи пользователю выполнить в Supabase SQL Editor.

### 2. Backend: Gemini API key в config
Файл: `backend/core/config.py`
- Добавь `GEMINI_API_KEY: str = ""` в Settings.
- Пользователь должен добавить в Railway env: `GEMINI_API_KEY=AIzaSyDkXkF3d7OrTA31n8tZMc8Q44xm3qOQ7ls`

### 3. Backend: Сервис стилизации фото
Создай файл: `backend/services/photo_styler.py`

**Логика:**
1. Принимает `photo_bytes` (JPEG) и `telegram_id`
2. Отправляет фото в Gemini 2.0 Flash (модель `gemini-2.0-flash-exp`) с `response_modalities=["Text", "Image"]`
3. Генерирует 2 версии с промптами:

**Dark (космос):**
```
Take this selfie portrait and transform it into a cosmic/space art style. 
Keep the person's face recognizable but make it look like a mystical space entity.
Add nebula textures, star clusters (similar to James Webb telescope images), 
and cosmic dust overlaying the face. The skin should have a subtle galactic glow.
The background should be deep space black with colorful nebulae.
Make it dark, atmospheric, and beautiful. Keep only the face and neck area in an oval composition.
The result should be a portrait-oriented image suitable as a phone wallpaper background.
```

**Light (медитация):**
```
Take this selfie portrait and transform it into a serene, meditative art style.
Keep the person's face recognizable but make them appear peaceful with eyes gently closed.
Use soft, warm, ethereal light tones — whites, light golds, soft pastels.
Add subtle light rays, floating particles of light, and a dreamy bokeh effect.
The skin should glow softly. The background should be pure white/cream with gentle gradients.
Make it calming, peaceful, and beautiful. Keep only the face and neck area in an oval composition.
The result should be a portrait-oriented image suitable as a phone wallpaper background.
```

4. Сохраняет обе версии в Supabase Storage: `avatars/{telegram_id}/dark.jpg` и `avatars/{telegram_id}/light.jpg`
5. Обновляет `users` таблицу: `photo_dark_url`, `photo_light_url`, `photo_processing = false`

**SDK:** `pip install google-genai Pillow` (добавь в requirements.txt)

**Код Gemini API (reference):**
```python
from google import genai
from google.genai import types
import base64

client = genai.Client(api_key=GEMINI_API_KEY)

# Отправить фото + промпт
response = client.models.generate_content(
    model="gemini-2.0-flash-exp",
    contents=[
        types.Part.from_bytes(data=photo_bytes, mime_type="image/jpeg"),
        "YOUR PROMPT HERE"
    ],
    config=types.GenerateContentConfig(
        response_modalities=["Text", "Image"],
    ),
)

# Извлечь результат
for part in response.candidates[0].content.parts:
    if part.inline_data:
        image_bytes = part.inline_data.data  # это bytes готового изображения
        # сохранить в Supabase Storage
```

**ВАЖНО:** Если Gemini вернёт ошибку "image generation not supported", используй модель `gemini-2.0-flash-preview-image-generation` или `imagen-3.0-generate-002`. Попробуй обе — одна из них сработает.

### 4. Backend: Фоновая задача в endpoint upload_photo
Файл: `backend/api/routers/users.py`

После успешной загрузки оригинала:
1. Установи `photo_processing = True` в БД
2. Запусти обработку в `asyncio.create_task()` (не блокируя ответ)
3. Верни `profile_photo_url` сразу (пользователь не ждёт)

```python
import asyncio
from ...services.photo_styler import process_photo_styles

# В конце upload_photo, ПЕРЕД return:
await db.table("users").update({"photo_processing": True}).eq("telegram_id", tid).execute()
asyncio.create_task(process_photo_styles(photo_bytes, tid))

return PhotoResponse(profile_photo_url=public_url)
```

### 5. Backend: Endpoint проверки статуса обработки
Добавь в `users.py`:
```python
@router.get("/me/photo-status")
async def photo_status(current_user: dict = Depends(get_current_user)):
    db = await get_supabase()
    result = await db.table("users").select(
        "photo_processing, photo_dark_url, photo_light_url"
    ).eq("telegram_id", current_user["telegram_id"]).single().execute()
    return result.data
```

### 6. Backend: Добавь photo_dark_url, photo_light_url в auth response
Файл: `backend/api/routers/auth.py`
- Добавь в `TokenResponse`: `photo_dark_url: str | None = None`, `photo_light_url: str | None = None`
- В select: добавь `photo_dark_url, photo_light_url`
- В return: передай оба поля

### 7. Frontend: authStore — добавь photoDarkUrl, photoLightUrl
Файл: `frontend/src/stores/authStore.ts`
- Добавь поля `photoDarkUrl: string | null` и `photoLightUrl: string | null`
- Обнови `setAuth` чтобы принимать и сохранять эти поля

### 8. Frontend: useAuth — передавай новые поля
Файл: `frontend/src/hooks/useAuth.ts`
- Передавай `data.photo_dark_url` и `data.photo_light_url` в `setAuth`
- Возвращай их из хука

### 9. Frontend: Backdrop — используй стилизованные фото
Файл: `frontend/src/design/backdrop/Backdrop.tsx`

Вместо:
```tsx
src={photoUrl || (theme === 'dark' ? womanCosmic : womanMeditating)}
```
Сделай:
```tsx
src={
  theme === 'dark'
    ? (photoDarkUrl || photoUrl || womanCosmic)
    : (photoLightUrl || photoUrl || womanMeditating)
}
```

Fallback: если стилизованные версии ещё не готовы — показывать оригинал.

### 10. Frontend: Поллинг статуса обработки
Файл: `frontend/src/hooks/useAuth.ts` (или новый хук)

После авторизации, если `photoUrl` есть но `photoDarkUrl` нет — поллить `/users/me/photo-status` каждые 5 секунд до получения обоих URL. Когда получены — обновить стор.

### 11. Frontend: Онбординг с плавным темпом
Файл: `frontend/src/components/onboarding/OnboardingFlow.tsx`

**Важно:** Онбординг должен идти медленно, чтобы AI успел обработать фото (10-30 сек).

- Добавь задержку 1.5 сек перед показом каждого следующего вопроса (fade in анимация)
- Добавь мотивирующий текст между вопросами ("Отличный выбор!", "Почти готово...")  
- После последнего вопроса — если обработка ещё идёт, покажи красивый экран:
  "Создаём ваш персональный мир..." с анимированными частицами
- Онбординг НЕ завершается пока `photo_processing === false`

### 12. TypeScript проверка
```bash
cd frontend && npx tsc --noEmit
```
Должен пройти без ошибок.

---

## Файлы для изменения (полный список)

| Файл | Действие |
|------|----------|
| `backend/core/config.py` | + GEMINI_API_KEY |
| `backend/requirements.txt` | + google-genai, Pillow |
| `backend/services/photo_styler.py` | НОВЫЙ — Gemini стилизация |
| `backend/api/routers/users.py` | + asyncio.create_task, + photo-status endpoint |
| `backend/api/routers/auth.py` | + photo_dark_url, photo_light_url в response |
| `backend/db/migrations/006_photo_styles.sql` | НОВЫЙ — миграция |
| `frontend/src/stores/authStore.ts` | + photoDarkUrl, photoLightUrl |
| `frontend/src/hooks/useAuth.ts` | + новые поля + поллинг |
| `frontend/src/design/backdrop/Backdrop.tsx` | dark/light фото по теме |
| `frontend/src/components/onboarding/OnboardingFlow.tsx` | + медленный темп + ожидание обработки |

---

## Ключевые ограничения
- **НЕ читай все файлы** — читай только те что меняешь
- **НЕ объясняй код** — Zero-Yapping Policy (см. CLAUDE.md)
- После завершения обнови `SESSION_STATUS.md`
- Railway env: `GEMINI_API_KEY=AIzaSyDkXkF3d7OrTA31n8tZMc8Q44xm3qOQ7ls`

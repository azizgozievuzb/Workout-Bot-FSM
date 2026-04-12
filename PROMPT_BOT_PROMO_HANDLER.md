# PROMPT: Бот + бэкенд — обработчик промокода и админ-логика

> Скопируй этот промпт целиком в Claude Code.

---

## Контекст

Прочитай `CLAUDE.md`, затем `SESSION_STATUS.md`. Две задачи: обновить Telegram-бот обработчик промокода + исправить админ-код в бэкенде.

---

## Задача 1: Бот — обработчик промокода (`backend/handlers/onboarding.py`)

### 1a. Сообщение при неверном коде

Сейчас при неверном промокоде приходит несколько отдельных сообщений. Нужно ОДНО сообщение:

- Неверный код, есть попытки → `"Осталось X попыток, введите код повторно."`
- Заблокирован → `"❌ Слишком много попыток. Повторите через X мин."`

### 1b. Блокировка всех команд кроме `/start`

В состоянии `resp_promo` юзер вводит ТОЛЬКО промокод. Все команды (кроме `/start`) блокируются:

```python
@resp.message()
async def handle_promo_input(message: Message, state: FSMContext):
    text = message.text or ""
    
    # Любая команда кроме /start → отклоняем
    if text.startswith('/'):
        if text.startswith('/start'):
            # /start → сбросить состояние, отправить свежее приглашение
            await state.clear()
            await state.set_state(OnboardingStates.resp_promo)
            await message.answer("👋 Введите ваш промокод для активации.")
            return
        else:
            await message.answer("Пожалуйста, введите только промокод.")
            return
    
    # Далее — валидация промокода...
```

### 1c. Ничего кроме кода вводить нельзя

Если юзер отправляет стикер, фото, голосовое — игнорировать или ответить:
```python
@resp.message(F.content_type != ContentType.TEXT)
async def handle_non_text(message: Message):
    await message.answer("Пожалуйста, введите только промокод.")
```

---

## Задача 2: Админ-код генерирует player_code (`backend/api/routers/promo.py`)

### Текущая проблема:
Админ-код (`ADMIN_PROMO_CODE=095709570957`) даёт `is_admin + has_player_access + has_responsible_access`, но НЕ генерирует player_code. Из-за этого админ не видит промокод для приглашения игрока в ActionCube.

### Исправление:

В функции `activate_promo`, блок обработки админ-кода — после установки флагов, добавить генерацию player_code:

```python
if code == settings.ADMIN_PROMO_CODE:
    # Проверить что этот юзер ещё не админ (защита от повторной активации)
    if user.is_admin:
        return ActivatePromoResponse(
            success=False, role_granted="", 
            message="Вы уже Админ."
        )
    
    user.is_admin = True
    user.has_player_access = True
    user.has_responsible_access = True
    user.primary_role = 'responsible'
    user.onboarding_done = True  # Админ не проходит онбординг
    await db.commit()
    
    # Сгенерировать player_code как обычному ответственному
    # (используй ту же функцию generate_player_code что для responsible_code)
    player_code_record = <вызови функцию генерации player_code с user.id>
    
    return ActivatePromoResponse(
        success=True,
        role_granted="admin",
        message="Добро пожаловать, Админ!",
        player_code=player_code_record.code
    )
```

**ВАЖНО:** Найди в `promo.py` функцию которая генерирует player_code (она вызывается при активации responsible_code) и переиспользуй её. НЕ дублируй код.

### Админ = полноценный ответственный

Админ — это обычный ответственный с тремя отличиями:
- `is_admin = true` → видит 4-й куб "Admin" (позже)
- `has_player_access = true` → может быть игроком без ответственного (уникальный случай)
- Получает player_code → может пригласить игрока как обычный ответственный

---

## Задача 3: Убедиться что `ADMIN_PROMO_CODE` читается из env

Проверь `backend/core/config.py`:
```python
ADMIN_PROMO_CODE: str = ""  # Должно быть без дефолта или с пустой строкой
BOT_USERNAME: str = ""
```

Проверь что в `.env.example`:
```
ADMIN_PROMO_CODE=your_admin_code_here
BOT_USERNAME=YourBotUsername
```

**НЕ хардкодь код `095709570957`** — только из env variable.

---

## Файлы для изменения

- `backend/handlers/onboarding.py` — блокировка команд, единое сообщение, /start reset
- `backend/api/routers/promo.py` — админ-код генерирует player_code
- `backend/core/config.py` — проверить ADMIN_PROMO_CODE
- `.env.example` — проверить переменные

## Проверка

```bash
cd backend && python3 -c "from api.routers.promo import router; print('OK')"
cd backend && python3 -c "from handlers.onboarding import router; print('OK')"
```

Обнови `SESSION_STATUS.md`.

## Чего НЕ делать
- НЕ трогай фронтенд
- НЕ хардкодь ADMIN_PROMO_CODE
- НЕ удаляй старый onboarding flow (backward compat)
- НЕ объясняй код

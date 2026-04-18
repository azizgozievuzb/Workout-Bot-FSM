# ТЕСТ-ПЛАН — Реальные аккаунты (Сессии 10–16)
> Workout Bot 4G · Ручная E2E проверка · Обновлено: 2026-04-18

---

## Тестовые аккаунты

| # | Роль | Имя | Username | Тир | Примечания |
|---|------|-----|----------|-----|------------|
| 1 | **Админ + Игрок** | AzizGoziev | @AzizGoziev | — | Создаёт все коды; будет приглашён как Игрок к @GmdLt |
| 2 | **Ответственный** (безлимит.) | Aziz | @GmdLt | STD (1 слот) | R-код от Админа; приглашает Админа как своего игрока |
| 3 | **Ответственный** + 2 игрока | Mr. | @Shekspe | ELT (3 слота) | R-код ELT от Админа; подключает @forcashe и @oldmae |
| 4 | **Игрок** | Dol | @forcashe | ELT | P-код от @Shekspe |
| 5 | **Игрок** | oil | @oldmae | ELT | P-код от @Shekspe |

### Итоговая схема связей
```
@AzizGoziev (Admin)
    ├── выдаёт STD R-код → @GmdLt (Ответственный)
    │       └── выдаёт P-код → @AzizGoziev (Admin as Player) ← взаимная связь!
    │
    └── выдаёт ELT R-код → @Shekspe (Ответственный, 3 слота)
            ├── P-код слот 1 → @forcashe (Игрок)
            ├── P-код слот 2 → @oldmae (Игрок)
            └── Слот 3 — свободен (или для 3-го тестового)
```

---

## Глобальные предусловия

- [ ] Миграции 014, 015, 016 применены в Supabase SQL Editor
- [ ] Все 5 аккаунтов открыли мини-апп хотя бы раз (запись в `users` создана)
- [ ] БД чистая перед стартом (или TRUNCATE + seed через бот)

### Базовая проверка схемы
```sql
SELECT enum_range(NULL::access_tier);
-- Ожидаем: {standard,premium,elite}

SELECT table_name FROM information_schema.tables
WHERE table_name IN ('app_settings','renewal_requests','ban_history');

SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'extend_active_promos_by_seconds';
```

---

---

# БЛОК A — Настройка аккаунтов (делать в этом порядке!)

## A.1 — @AzizGoziev становится Админом

1. [ ] @AzizGoziev открывает мини-апп → OnboardingFlow → вводит `ADMIN_PROMO_CODE`
2. [ ] Успех: «Добро пожаловать, Админ!»
3. [ ] Видит 4 куба (Action, Market, Bond, Admin)
4. [ ] Проверяем БД:
```sql
SELECT telegram_id, is_admin, has_responsible_access, has_player_access, primary_role, access_tier
FROM users WHERE telegram_username = 'AzizGoziev';
-- Ожидаем: is_admin=true, has_responsible_access=true, has_player_access=false, primary_role='responsible'
```

---

## A.2 — @AzizGoziev выдаёт STD R-код для @GmdLt

5. [ ] @AzizGoziev → AdminCube → таб «Промокоды» → таб **R-код**
6. [ ] Тир: **STD (standard)**, Длительность: **30 дней** → «Сгенерировать»
7. [ ] Код появился с бейджем **STD** → копируем (обозначим `RCODE_GMDLT`)
8. [ ] Проверяем БД:
```sql
SELECT code, access_tier, duration_days, code_type, is_used
FROM promo_codes WHERE code = '<RCODE_GMDLT>';
-- Ожидаем: access_tier='standard', duration_days=30, code_type='responsible', is_used=false
```

---

## A.3 — @GmdLt активирует R-код → становится Ответственным

9. [ ] @GmdLt открывает мини-апп → OnboardingFlow → вводит `RCODE_GMDLT`
10. [ ] Успех: «Поздравляю, вы теперь Ответственный!»
11. [ ] Видит ActionCube (вид Ответственного) с кодом и **бейджем STD**
12. [ ] Видит счётчик слотов **0/1** рядом с «Мои Игроки»
13. [ ] Проверяем БД:
```sql
SELECT has_responsible_access, access_tier, primary_role
FROM users WHERE telegram_username = 'GmdLt';
-- Ожидаем: has_responsible_access=true, access_tier='standard', primary_role='responsible'
```

---

## A.4 — Взаимная связь: @GmdLt приглашает @AzizGoziev как Игрока

14. [ ] @GmdLt → ActionCube → Ответственный вид → копирует P-код (обозначим `PCODE_FOR_AZIZ`)
15. [ ] @AzizGoziev (Админ!) открывает ActionCube → **переключается в вид Игрока** (dual-role toggle)
16. [ ] Нажимает «Ввести промокод» (если есть) или переходит в OnboardingFlow для Player
    > *Или: @AzizGoziev вводит PCODE_FOR_AZIZ через любой доступный способ (deep link / ввод кода)*
17. [ ] Успех: «Вы теперь Игрок у Aziz!»
18. [ ] Проверяем, что роль Админа НЕ перезаписана:
```sql
SELECT is_admin, has_responsible_access, has_player_access, primary_role, access_tier
FROM users WHERE telegram_username = 'AzizGoziev';
-- КРИТИЧНО: is_admin=true, has_responsible_access=true, has_player_access=true
-- primary_role НЕ должен стать 'player' — должен остаться 'responsible'
-- access_tier='standard' (унаследован от P-кода @GmdLt)
```
19. [ ] @AzizGoziev видит 4 куба (Admin не теряет доступ)
20. [ ] В ActionCube @AzizGoziev теперь есть **оба вида**: Player (с TTL-чипом) и Responsible (с кодом)
21. [ ] @GmdLt → ActionCube → «Мои Игроки» → видит **@AzizGoziev** в списке
22. [ ] Счётчик у @GmdLt: **1/1** (слот заполнен)
23. [ ] P-код у @GmdLt больше не показывается (слоты заполнены → «Все слоты заняты»)
24. [ ] Проверяем partnership:
```sql
SELECT p.status, u_r.telegram_username AS responsible, u_p.telegram_username AS player
FROM partnerships p
JOIN users u_r ON u_r.id = p.responsible_id
JOIN users u_p ON u_p.id = p.player_id
WHERE u_r.telegram_username = 'GmdLt';
-- Ожидаем: status='active', player='AzizGoziev'
```

---

## A.5 — @AzizGoziev выдаёт ELT R-код для @Shekspe

25. [ ] @AzizGoziev → AdminCube → R-код → Тир: **ELT (elite)**, Длительность: **30 дней**
26. [ ] Код с бейджем **ELT** (обозначим `RCODE_SHEKSPE`)
27. [ ] Проверяем БД:
```sql
SELECT access_tier, code_type FROM promo_codes WHERE code = '<RCODE_SHEKSPE>';
-- Ожидаем: access_tier='elite', code_type='responsible'
```

---

## A.6 — @Shekspe активирует ELT R-код

28. [ ] @Shekspe открывает мини-апп → вводит `RCODE_SHEKSPE`
29. [ ] Успех: «Ответственный»
30. [ ] ActionCube показывает бейдж **ELT** рядом с кодом
31. [ ] Счётчик слотов: **0/3**
32. [ ] Проверяем БД:
```sql
SELECT access_tier, has_responsible_access FROM users WHERE telegram_username = 'Shekspe';
-- Ожидаем: access_tier='elite', has_responsible_access=true
```

---

## A.7 — @Shekspe приглашает @forcashe и @oldmae

**Слот 1 — @forcashe:**

33. [ ] @Shekspe копирует P-код (обозначим `PCODE_1`)
34. [ ] @forcashe открывает мини-апп → вводит `PCODE_1`
35. [ ] Успех: «Вы теперь Игрок!», тир ELT
36. [ ] Счётчик у @Shekspe: **1/3**

**Слот 2 — @oldmae:**

37. [ ] @Shekspe копирует следующий P-код (автоматически регенерировался после активации слота 1)
38. [ ] @oldmae вводит код → становится Игроком ELT
39. [ ] Счётчик у @Shekspe: **2/3**

**Проверяем после обоих:**
```sql
SELECT u.telegram_username, u.access_tier, pc.expires_at
FROM users u
JOIN promo_codes pc ON pc.activated_by = u.telegram_id
WHERE u.telegram_username IN ('forcashe', 'oldmae')
  AND pc.code_type = 'player' AND pc.is_used = true;
-- Ожидаем: оба access_tier='elite', expires_at ≈ now + 30 days
```

40. [ ] @Shekspe видит в «Мои Игроки»: @forcashe и @oldmae, оба с бейджем **ELT**
41. [ ] У @Shekspe ещё показывается P-код и счётчик **2/3** (1 слот остался)

---

---

# БЛОК B — Проверка лимитов слотов по тирам

## B.1 — STD: лимит 1 игрок (@GmdLt)

1. [ ] @GmdLt → ActionCube → «Все слоты заняты» (1/1)
2. [ ] P-код НЕ показывается (UI блокирует)
3. [ ] Попытка активировать P-код @GmdLt вторым игроком через direct API:
   `POST /promo/activate` с ещё одним P-кодом от @GmdLt (если есть)
4. [ ] Ожидаем: 409 `PLAYER_LIMIT_REACHED`
```json
{"code": "PLAYER_LIMIT_REACHED", "limit": 1, "tier": "standard"}
```

## B.2 — ELT: лимит 3 игрока (@Shekspe)

5. [ ] @Shekspe пригласил 2/3 → слот ещё есть → P-код виден ✓
6. [ ] Добавляем 3-го игрока (любой тестовый аккаунт)
7. [ ] После активации счётчик: **3/3**, P-код исчезает, «Все слоты заняты»
8. [ ] 4-я попытка активации → 409 `PLAYER_LIMIT_REACHED` с `"limit": 3`

## B.3 — access_tier из /auth/telegram

9. [ ] @forcashe перезагружает мини-апп
10. [ ] `/auth/telegram` возвращает `access_tier: "elite"` в ответе
11. [ ] `accessTier` в authStore = `'elite'`
```sql
SELECT access_tier FROM users WHERE telegram_username = 'forcashe';
-- Ожидаем: 'elite'
```

---

---

# БЛОК C — 6-й слот в магазине

## C.1 — Заблокированный 6-й слот (STD/PRM игроки)

1. [ ] @AzizGoziev → MarketCube → вид Игрока
2. [ ] Тир `access_tier = 'standard'` → 6-й слот показывает 🔒 с текстом «Elite»
3. [ ] Кнопка задизейблена
4. [ ] Слот non-interactive (нет реакции на тап)

## C.2 — Разблокированный 6-й слот: вид Игрока (ELT)

5. [ ] @forcashe → MarketCube → вид Игрока
6. [ ] `accessTier = 'elite'` → 6-й слот показывает **реальный товар** из `items[5]` (если есть) или слот пропадает (товаров <6)
7. [ ] Кнопка «Купить» активна при достаточном балансе
8. [ ] @oldmae → то же самое

## C.3 — Разблокированный 6-й слот: вид Ответственного (ELT)

9. [ ] @Shekspe (ELT Ответственный) → MarketCube → вид Ответственного
10. [ ] Таб любого игрока (@forcashe / @oldmae) — 6-й слот отображается как активный товар (кнопка «Подарить»)
11. [ ] @GmdLt (STD Ответственный) → MarketCube → вид Ответственного → 6-й слот заблокирован 🔒 ELT

### Проверка через SQL
```sql
SELECT COUNT(*) FROM shop_items WHERE is_active = true;
-- Если >= 6 → @forcashe и @Shekspe видят все 6 позиций
-- Если < 6  → 6-й слот не отображается (items[5] = undefined)
```

---

---

# БЛОК D — Maintenance Mode

## D.1 — Включение maintenance Админом

1. [ ] @AzizGoziev → AdminCube → «Настройки» → тогл «Режим обслуживания»
2. [ ] Диалог подтверждения → Confirm
3. [ ] Frozen Timer начинает идти вверх
4. [ ] Плавающий баннер «🔧 Maintenance ON» виден только у Админа
5. [ ] @GmdLt (Ответственный) делает любой запрос → **MaintenanceScreen** (SVG шестерёнка)
6. [ ] @forcashe (Игрок ELT) → **MaintenanceScreen**
7. [ ] @AzizGoziev (Админ) → **главное меню** (не блокируется)
8. [ ] Проверяем БД:
```sql
SELECT maintenance_mode, maintenance_started_at FROM app_settings WHERE id = 1;
-- Ожидаем: maintenance_mode=true
```

## D.2 — Отключение + TTL-компенсация

9. [ ] Ждём 30+ секунд → фиксируем `maintenance_started_at` из БД
10. [ ] Фиксируем текущий `expires_at` Игрока @forcashe:
```sql
SELECT expires_at FROM promo_codes
WHERE activated_by = (SELECT telegram_id FROM users WHERE telegram_username = 'forcashe')
  AND is_used = true ORDER BY expires_at DESC LIMIT 1;
```
11. [ ] Админ → тогл OFF → подтверждаем
12. [ ] Проверяем, что TTL продлён на время заморозки:
```sql
SELECT expires_at FROM promo_codes
WHERE activated_by = (SELECT telegram_id FROM users WHERE telegram_username = 'forcashe')
  AND is_used = true ORDER BY expires_at DESC LIMIT 1;
-- expires_at должен быть ≈ на frozen_seconds больше предыдущего значения
```
13. [ ] @GmdLt и @forcashe обновляют приложение → MaintenanceScreen исчезает

---

---

# БЛОК E — Баны

## E.1 — Бан @forcashe Админом

1. [ ] @AzizGoziev → AdminCube → Соединения → найти @forcashe → ⋮ → «Забанить»
2. [ ] BanUserModal: чипы 2д (станд) / 7 / 14 / 30 → выбираем **2 дня**
3. [ ] Причина: «тест бана» → submit
4. [ ] @forcashe открывает мини-апп → **BanScreen**:
    - [ ] Показывает причину «тест бана»
    - [ ] `Осталось: 2 дн.`
    - [ ] Цвет акцента через `var(--tg-theme-destructive-text-color)` (не агрессивный фон)
5. [ ] Проверяем БД:
```sql
SELECT ban_until, ban_reason FROM users WHERE telegram_username = 'forcashe';
SELECT user_id, banned_at, ban_until FROM ban_history
WHERE user_id = (SELECT id FROM users WHERE telegram_username = 'forcashe');
-- ban_history должен содержать запись
```

## E.2 — Досрочный разбан

6. [ ] @AzizGoziev → AdminCube → таб «Баны» → фильтр 🔴 Активен → @forcashe → «Разбанить»
7. [ ] @forcashe обновляет приложение → главное меню
8. [ ] Проверяем:
```sql
SELECT ban_until FROM users WHERE telegram_username = 'forcashe';
-- Ожидаем: NULL

SELECT unbanned_early_at FROM ban_history
WHERE user_id = (SELECT id FROM users WHERE telegram_username = 'forcashe')
ORDER BY banned_at DESC LIMIT 1;
-- Ожидаем: NOT NULL
```

## E.3 — Maintenance + Бан одновременно

9. [ ] Включаем maintenance, одновременно баним @oldmae
10. [ ] @oldmae открывает мини-апп → **BanScreen** (приоритет над MaintenanceScreen)
11. [ ] Выключаем maintenance → @oldmae всё ещё видит BanScreen
12. [ ] Разбаниваем @oldmae → главное меню

---

---

# БЛОК F — Renewal Reversal (Ответственный продлевает Игрока)

## Предусловие
```sql
-- Искусственно уменьшаем TTL для @forcashe
UPDATE promo_codes SET expires_at = now() + interval '5 days'
WHERE activated_by = (SELECT telegram_id FROM users WHERE telegram_username = 'forcashe')
  AND is_used = true;
```

## F.1 — @forcashe запрашивает продление

1. [ ] @forcashe → ActionCube → блок renewal-prompt виден (days_left ≤ 7)
2. [ ] Нажимает «Попросить Ответственного продлить»
3. [ ] Кнопка → «✓ Запрос отправлен» (disabled)
4. [ ] Проверяем:
```sql
SELECT player_id, resolved_at FROM renewal_requests
WHERE player_id = (SELECT id FROM users WHERE telegram_username = 'forcashe')
ORDER BY created_at DESC LIMIT 1;
-- resolved_at IS NULL
```
5. [ ] Повторный тап → «Уже отправлено» (кулдаун 24ч)

## F.2 — @Shekspe видит запрос и продлевает

6. [ ] @Shekspe → ActionCube → «Мои Игроки» → строка @forcashe пульсирует «🔔 Просит продлить»
7. [ ] Нажимает «Продлить» → **RenewalModal**
8. [ ] @AzizGoziev (Админ) генерирует **ELT Renewal-код** (dur: 30 дней) → передаёт @Shekspe
9. [ ] @Shekspe вводит renewal-код → «Продлено на 30 дн.», haptic success

**Проверяем:**
```sql
SELECT expires_at FROM promo_codes
WHERE activated_by = (SELECT telegram_id FROM users WHERE telegram_username = 'forcashe')
  AND is_used = true ORDER BY expires_at DESC LIMIT 1;
-- Ожидаем: ≈ now + 35 days (5 оставшихся + 30 продлённых)

SELECT resolved_at FROM renewal_requests
WHERE player_id = (SELECT id FROM users WHERE telegram_username = 'forcashe')
ORDER BY created_at DESC LIMIT 1;
-- resolved_at IS NOT NULL
```
10. [ ] Строка @forcashe у @Shekspe больше не пульсирует

## F.3 — Тест несоответствия тира (tier mismatch)

11. [ ] Админ генерирует **STD** renewal-код
12. [ ] @Shekspe пробует применить STD-код для ELT-игрока @forcashe → ошибка `TIER_MISMATCH`
13. [ ] STD-код остался неиспользованным:
```sql
SELECT is_used FROM promo_codes WHERE code = '<std_renewal_code>';
-- Ожидаем: false
```

---

---

# БЛОК G — Admin Screen II: Таблица / Batch Buy / История банов

## G.1 — Таблица R↔P с агрегатами

1. [ ] @AzizGoziev → AdminCube → «Соединения» → переключиться в **Таблица**
2. [ ] Строка @GmdLt:
    - [ ] Показывает 1 игрока (@AzizGoziev)
    - [ ] `completion_rate` вычислен
3. [ ] Строка @Shekspe:
    - [ ] Показывает 2 игроков (@forcashe, @oldmae) — или 3 если добавили 3-го
4. [ ] Нажимаем на строку @Shekspe → аккордеон разворачивается → видим P-строки
5. [ ] Каждая P-строка: `days_left`, `CompletionBar`, ⋮-меню (Забанить/Разбанить)
6. [ ] Переключаемся в **Карточки** → карточки с прогрессбаром

## G.2 — Batch Buy кодов

7. [ ] @AzizGoziev → AdminCube → «Промокоды» → «Купить пачку»
8. [ ] Таб **Responsible** → Тир **ELT** → Длительность **30 дней** → Количество **5**
9. [ ] Генерируем → список 5 ELT-кодов
10. [ ] «Копировать все» → буфер обмена
11. [ ] Haptic success
```sql
SELECT COUNT(*) FROM promo_codes
WHERE created_at > now() - interval '5 minutes'
  AND code_type = 'responsible' AND access_tier = 'elite';
-- Ожидаем: 5
```

## G.3 — История банов (@forcashe был забанен в Блоке E)

12. [ ] @AzizGoziev → AdminCube → таб «Баны»
13. [ ] Фильтр **🟢 Снят** → видим запись @forcashe с `unbanned_early_at`
14. [ ] Аккордеон: причина «тест бана», missed_workouts
15. [ ] Фильтр **Все** → видим все записи

---

---

# БЛОК H — Stars/Crypto Coming Soon

## H.1 — BuyCodesModal

1. [ ] Открываем «Купить пачку» → секция **Способ оплаты** над кнопкой Submit
2. [ ] 🎁 **Free** — активна по умолчанию
3. [ ] ⭐ **Stars** — disabled → тап → haptic warning + тост «Stars оплата — скоро» (~2.5с)
4. [ ] 💎 **Crypto** — disabled → тап → тост «Crypto оплата — скоро»
5. [ ] Submit с выбранным Free → коды генерируются

## H.2 — MarketCube Coming Soon hint

6. [ ] @forcashe → MarketCube → вверху блок с 2 строками:
    - [ ] «⭐ Оплата Stars — скоро»
    - [ ] «💎 Crypto (TON) — скоро»
7. [ ] Блок с opacity 0.75, не кликабельный
8. [ ] Светлая тема: цвета корректны (theme vars)

---

---

# БЛОК I — Граничные случаи

## I.1 — Взаимная связь: @AzizGoziev имеет оба вида в ActionCube

1. [ ] @AzizGoziev → ActionCube → dual-role toggle доступен
2. [ ] Вид **Игрока**: TTL-чип с датой истечения (от P-кода @GmdLt), кнопка «Приступим»
3. [ ] Вид **Ответственного**: P-код с бейджем STD, счётчик 0/1, «Мои Игроки» (пустой или другие)
4. [ ] AdminCube по-прежнему доступен (is_admin не затронут)

## I.2 — @GmdLt не может пригласить 2-го игрока (STD лимит)

5. [ ] @GmdLt → ActionCube → «Все слоты заняты» (1/1)
6. [ ] Если попытаться активировать старый P-код @GmdLt другим аккаунтом → 409 `PLAYER_LIMIT_REACHED`

## I.3 — Истечение TTL у @AzizGoziev как Игрока

7. [ ] Искусственно истекаем P-код @AzizGoziev:
```sql
UPDATE promo_codes SET expires_at = now() - interval '1 second'
WHERE activated_by = (SELECT telegram_id FROM users WHERE telegram_username = 'AzizGoziev')
  AND is_used = true AND code_type = 'player';
```
8. [ ] @AzizGoziev открывает вид Игрока в ActionCube → **AccessRevokedScreen** (или 403)
9. [ ] **Критично**: Вид Ответственного и AdminCube — по-прежнему доступны (только player-доступ истёк)
10. [ ] is_admin и has_responsible_access в БД не изменились:
```sql
SELECT is_admin, has_responsible_access, has_player_access
FROM users WHERE telegram_username = 'AzizGoziev';
-- is_admin=true, has_responsible_access=true — должны остаться нетронутыми
```

## I.4 — Попытка активировать собственный код

11. [ ] @Shekspe пробует активировать собственный P-код → 400 «Нельзя использовать свой собственный код»

## I.5 — Гонка при активации (race condition)

12. [ ] Одновременные запросы от @forcashe и @oldmae с одним кодом
13. [ ] Один получает 200, второй — 409
```sql
SELECT is_used, used_by FROM promo_codes WHERE code = '<test_code>';
-- is_used=true, ровно один used_by
```

---

---

# БЛОК J — Регрессия (предыдущие сессии)

## J.1 — Variant B: регистрация без бота (Сессия 6)

1. [ ] Новый аккаунт (не в БД) открывает мини-апп → OnboardingFlow появляется автоматически
2. [ ] Вводит ADMIN_PROMO_CODE → Admin → PhotoGate → 4 куба
3. [ ] Или вводит R-код → Responsible → ActionCube

## J.2 — TTL lifecycle (Сессия 1)

1. [ ] Устанавливаем `expires_at = now() + interval '1 minute'` для @oldmae
2. [ ] Ждём APScheduler → прomo архивируется → @oldmae видит AccessRevokedScreen
3. [ ] RPC `extend_active_promos_by_seconds` не трогает истёкшие коды (тест из Epic 1.4)

## J.3 — Аватар / кроссфейд (Сессия 4)

1. [ ] Любой аккаунт: перезагрузка → аватар появляется мгновенно (localStorage cache)
2. [ ] Hold + swipe → смена темы → кроссфейд 1.5с без сдвига

## J.4 — Haptic singleton (Сессия 12)

1. [ ] Все CTA в AdminCube → вибрация (hapticImpact)
2. [ ] Нет `useHapticFeedback` хука в коде

## J.5 — Перехватчики API

1. [ ] 503 MAINTENANCE → MaintenanceScreen
2. [ ] 403 BANNED → BanScreen
3. [ ] 403 PROMO_EXPIRED → AccessRevokedScreen
4. [ ] Повторная авторизация сбрасывает флаг `access_revoked` (нет бесконечного цикла)

---

*Конец TEST_PLAN.md*

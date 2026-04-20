# SESSION_23_BUGFIX.md — Исправление багов перед релизом v2

> **Временный файл.** Дополняет `SESSION_23_PLAN.md`. Оба документа удаляются после полного прохождения Этапа 4 (Acceptance).
> **Цель:** закрыть 6 подтверждённых багов, найденных архитектором-тестировщиком.
> **Статус:** B1 снят (ложное срабатывание). B2 снят (UI не даёт Player-у получить чужой item_id — тычок по кнопке, без ввода UUID). Активны B3–B8.

---

## 📋 Сводная таблица

| # | Название | Severity | Файлы | Решение пользователя |
|---|---|---|---|---|
| ~~B1~~ | ~~Slot-limit игнорирует истёкшие~~ | — | — | Ложь. `partnerships.status` не меняется scheduler-ом, slot занят до hard-delete / Job G. |
| ~~B2~~ | ~~`/shop/purchase` не чекает `item.player_id == buyer_id`~~ | — | — | Снят. UI-only кнопка без ввода UUID; эксплойт требует прямой вызов API (curl/Postman) — не угроза для обычного Telegram-пользователя. |
| **B3** | Race на `streak_freeze_balance` в purchase | ⚠️ WARN | `backend/api/routers/shop.py` | Добавить optimistic lock + retry. |
| **B4** | Responsible A видит магазин Player-а Responsible B | 🚫 BLOCK | `backend/api/routers/shop.py` | Категорически запретить. Только свои партнёрства. |
| **B5** | `resurrect_player_id` по факту = `partnership_id` | ⚠️ WARN | `backend/api/routers/promo.py` + `frontend/src/api/promo.ts` | Rename → `resurrect_partnership_id`. |
| **B6** | Legacy `POST /admin/promo/create` | ℹ️ INFO | `backend/api/routers/admin.py` | Удалить dead endpoint. |
| **B7** | Dual-role: `access_tier` затирается при активации P-кода | 🚫 BLOCK | migration + `backend/api/routers/*.py` + `frontend/src/stores/authStore.ts` | Две колонки: `responsible_access_tier` + `player_access_tier` (nullable). `users.access_tier` остаётся для legacy-compat, read-only. |
| **B8** | Уведомление об удалении партнёрства не доходит | ℹ️ INFO | `backend/api/routers/partnerships.py` + `backend/services/bot_notify.py` (новый) | Отправить сообщение в Telegram bot напрямую. |

---

## 🤖 Промпты для Claude Code CLI

Каждый промпт — один коммит. Запускать через `claude --dangerously-skip-permissions` в папке проекта. Отмечать `[x]` после прохождения Acceptance.

**Формат:** мета (Effort / Model / Transcript View) — ВНЕ промпта, это инструкция пользователю как запустить CLI. Сам промпт — чистая задача для Claude.

---

### ~~B2~~ — снят (UI-only кнопка, нет пути к чужому item_id без curl/Postman)

---

### [x] B3 — Race: optimistic lock на streak_freeze_balance в purchase — commit `8cf6abf`

**Meta (вне промпта):**
- ⚙️ Effort: `think hard`
- 🧠 Model: `claude-sonnet-4-5`
- 👁 Transcript View: Ctrl+R

**Промпт:**

```
Task: Fix race condition on player_stats.streak_freeze_balance в POST /shop/purchase для item_type='streak_freeze'. Добавить optimistic lock + retry, аналогично уже работающему gift_freeze-блоку в том же файле.

=== ЧТО ПРОИСХОДИТ СЕЙЧАС (баг) ===

В backend/api/routers/shop.py::purchase_item (~L404-420) для streak_freeze делается безусловный UPDATE:
    new_balance = current_balance + freeze_count
    UPDATE player_stats SET streak_freeze_balance = new_balance WHERE user_id = ...

Два параллельных запроса (разные item_id) оба читают current_balance=0, оба пишут new_balance=1 — один freeze потерян.

В том же файле для gift_freeze (~L497-547) уже сделан правильный optimistic lock — reference-pattern.

=== ЧТО НУЖНО СДЕЛАТЬ ===

Файл: backend/api/routers/shop.py, функция purchase_item, блок `if item_type == "streak_freeze":` (~L405-418).

1. Заменить безусловный UPDATE на retry-loop (макс 2 попытки) с optimistic lock:
   - READ current streak_freeze_balance.
   - UPDATE ... WHERE user_id=... AND streak_freeze_balance=<previous> RETURNING streak_freeze_balance.
   - Если returned row пустой — retry.
   - После 2 неудачных попыток → HTTPException 409 {"code": "RACE"}.

2. При 409 выполнить ROLLBACK star_balance тем же optimistic-pattern (макс 3 попытки). Если и rollback не удался — log CRITICAL "freeze purchase rollback FAILED user=... amount=..." и всё равно отдать 409 клиенту.

3. DELETE из shop_items — строго ПОСЛЕ успешного UPDATE freeze-баланса.

4. Native/targeted-логика лотов не меняется.

=== ФАЙЛЫ READ-ONLY ===

- backend/api/routers/shop.py (gift_freeze — эталон).

=== НЕ ТРОГАЙ ===

- gift_freeze блок — reference-pattern.
- schema shop_items / player_stats.
- Логику входного списания star_balance (только добавь rollback при 409).
- Другие item_types.

=== ACCEPTANCE ===

1. Два параллельных POST /shop/purchase (разные item_id, оба streak_freeze, freeze_count=1) → streak_freeze_balance = 2.
2. 10 параллельных покупок по 1 шт → balance = 10.
3. Искусственный RACE → 409 + star_balance восстановлен.
4. Одиночная покупка → 200, без регрессий.
```

---

### [x] B4 — Privacy: GET /shop/items проверяет ownership partnership — commit `d13a954`

**Meta (вне промпта):**
- ⚙️ Effort: `think`
- 🧠 Model: `claude-sonnet-4-5`
- 👁 Transcript View: Ctrl+R

**Промпт:**

```
Task: Закрыть privacy-дыру в GET /shop/items — Responsible A не должен видеть магазин Player-а, который привязан к Responsible B.

=== ЧТО ПРОИСХОДИТ СЕЙЧАС (баг) ===

GET /shop/items?player_id=<X> для Responsible-а НЕ проверяет, что <X> реально его партнёр. Responsible A, зная UUID Player-а из чужого партнёрства, может прочитать содержимое его магазина.

=== ЧТО НУЖНО СДЕЛАТЬ ===

Файл: backend/api/routers/shop.py, функция get_shop_items (~L113-171).

1. Если role in ("responsible", "admin") И передан query-param player_id:
   - SELECT 1 FROM partnerships WHERE responsible_id=<me_id> AND player_id=<player_id> LIMIT 1.
   - Не найдено → HTTPException 403 {"code": "NOT_YOUR_PLAYER"}.
2. Admin тоже проверяется этим же правилом (если нужен глобальный admin-view — это отдельный endpoint, не здесь).
3. Native лоты (responsible_id IS NULL) возвращаются как раньше.
4. Player (role='player') — endpoint игнорирует query-param player_id, использует собственный me_id. Без изменений.

=== ФАЙЛЫ READ-ONLY ===

- backend/api/routers/shop.py.

=== НЕ ТРОГАЙ ===

- Логику нативных лотов.
- Schema shop_items.
- POST /shop/purchase.

=== ACCEPTANCE ===

1. Test 5.10 из TEST_PLAN_SESSION_23.md: Responsible A + player_id чужого Player-а → 403 NOT_YOUR_PLAYER.
2. Responsible A + player_id собственного Player-а → 200 + корректный список лотов.
3. Player без query-param → 200, видит только свои лоты.
```

---

### [x] B5 — Rename resurrect_player_id → resurrect_partnership_id — commit `9876e68`

**Meta (вне промпта):**
- ⚙️ Effort: `think`
- 🧠 Model: `claude-sonnet-4-5`
- 👁 Transcript View: Ctrl+R

**Промпт:**

```
Task: Переименовать поле `resurrect_player_id` → `resurrect_partnership_id` в API + FE типах. Текущее имя вводит в заблуждение — по факту туда передаётся partnership.id, а не player.id.

=== ЧТО НУЖНО СДЕЛАТЬ ===

1. backend/api/routers/promo.py:
   - Pydantic класс ActivatePromoRequest (~L34-37): field `resurrect_player_id: uuid.UUID | None` → `resurrect_partnership_id: uuid.UUID | None`.
   - Все обращения в теле activate_promo (R-code branch ~L447-478): body.resurrect_player_id → body.resurrect_partnership_id.

2. frontend/src/api/promo.ts:
   - Type ApplyTierCodeRequest: поле `resurrect_player_id?` → `resurrect_partnership_id?`.

3. Любые FE-компоненты, передающие это поле (ищи grep-ом "resurrect_player_id" по всему frontend/src/) — переименовать.

=== ФАЙЛЫ READ-ONLY ===

- backend/api/routers/promo.py.
- frontend/src/api/promo.ts.
- frontend/src/components/responsible/TierChangeModal.tsx (если существует).

=== НЕ ТРОГАЙ ===

- Саму resurrect-логику (она корректна).
- Другие поля Pydantic-модели.

=== ACCEPTANCE ===

1. POST /promo/activate с `{"code":"RE...","resurrect_partnership_id":"<uuid>"}` → 200.
2. Тот же запрос с old key `resurrect_player_id` → 422 Unprocessable Entity.
3. `cd frontend && npx tsc --noEmit` → exit 0.
4. `rg "resurrect_player_id" backend/ frontend/src/` → пусто (кроме миграций/истории).
```

---

### [x] B6 — Remove legacy POST /admin/promo/create — commit `05788b7`

**Meta (вне промпта):**
- ⚙️ Effort: `think`
- 🧠 Model: `claude-haiku-4-5-20251001` (простая зачистка dead-кода)
- 👁 Transcript View: Ctrl+R

**Промпт:**

```
Task: Удалить dead endpoint POST /admin/promo/create (заменён на /admin/promo/tier в v2) + все связанные dead-классы и вызовы на FE.

=== ЧТО НУЖНО СДЕЛАТЬ ===

1. backend/api/routers/admin.py:
   - Удалить функцию `create_promo` + декоратор `@router.post("/create")` (~L196-230).
   - Удалить Pydantic-классы `CreatePromoRequest`, `CreatePromoResponse` (~L27-34) — если grep подтверждает, что они больше нигде не используются.
   - Удалить helper `_generate_responsible_code()` — если больше нигде не вызывается.

2. frontend/src/api/admin.ts:
   - Удалить функцию-обёртку `createPromo()` / любые вызовы `POST /admin/promo/create`.

3. Любые FE-компоненты, использующие `createPromo()` — удалить эти места (если остались — значит dead code UI, выпиливай).

4. Верификация grep:
   - `rg "promo/create" backend/ frontend/src/` → пусто (только миграции допустимы).
   - `rg "CreatePromoRequest|CreatePromoResponse|_generate_responsible_code|createPromo" backend/ frontend/src/` → пусто.

=== ФАЙЛЫ READ-ONLY ===

- backend/api/routers/admin.py.
- frontend/src/api/admin.ts.

=== НЕ ТРОГАЙ ===

- POST /admin/promo/tier (актуальный endpoint).
- batch-buy endpoint.
- renewal-endpoint-ы.

=== ACCEPTANCE ===

1. curl -X POST http://localhost:8000/admin/promo/create → 404 Not Found.
2. POST /admin/promo/tier и batch-buy работают как раньше.
3. `cd frontend && npm run build` → green.
4. `cd backend && python -c "from api.routers.admin import router"` → без ImportError.
```

---

### [ ] B7 — Dual-role tiers: разделить responsible_access_tier и player_access_tier

Самый объёмный fix. Миграция + рефакторинг нескольких файлов backend + FE.

**Meta (вне промпта):**
- ⚙️ Effort: `ultrathink`
- 🧠 Model: `claude-opus-4-6` (сложный multi-file архитектурный рефакторинг + миграция)
- 👁 Transcript View: Ctrl+R (очень важно — много tool-calls)

**Промпт:**

```
Task: Разделить одну колонку users.access_tier на две — responsible_access_tier (свой тир как Ответственного) и player_access_tier (наследованный от Responsible при активации P-кода). Это закрывает баг, когда активация P-кода затирает тир Ответственного у dual-role пользователя.

=== АРХИТЕКТУРНОЕ РЕШЕНИЕ ===

У каждого пользователя могут быть ОБЕ роли одновременно:
- responsible_access_tier — своё подписочное право (купил сам, даёт право выдавать коды игрокам).
- player_access_tier — наследуется от Ответственного при активации P-кода.

Колонка users.access_tier остаётся в схеме как legacy (не дропаем в этой миграции — DROP в 022 после полной миграции FE/legacy-кода).

=== ИЗМЕНЕНИЯ ===

1. Новая миграция `backend/db/migrations/021_dual_role_tiers.sql` (применить через Supabase MCP apply_migration):
   ```sql
   ALTER TABLE users ADD COLUMN IF NOT EXISTS responsible_access_tier VARCHAR(16);
   ALTER TABLE users ADD COLUMN IF NOT EXISTS player_access_tier VARCHAR(16);
   -- Backfill:
   UPDATE users SET responsible_access_tier = access_tier
     WHERE (is_admin = TRUE OR has_responsible_access = TRUE) AND access_tier IS NOT NULL;
   UPDATE users SET player_access_tier = access_tier
     WHERE has_player_access = TRUE AND access_tier IS NOT NULL;
   -- users.access_tier оставить (legacy, удалим в 022).
   ```

2. backend/api/routers/promo.py::_activate_player_code (~L248-262):
   - Было: `user_update = {"access_tier": code_tier, ...}`.
   - Стало: `user_update = {"player_access_tier": code_tier, ...}`. Глобальный access_tier НЕ перезаписывать.

3. backend/api/routers/promo.py::activate_promo, R-code branch (~L481-494):
   - Было: `user_update = {"access_tier": r_access_tier, ...}`.
   - Стало: `user_update = {"responsible_access_tier": r_access_tier, ...}`.

4. backend/api/routers/auth.py::_build_full_token_response (~L95-100):
   - USER_SELECT_COLS: добавить `responsible_access_tier, player_access_tier`.
   - `own_access_tier = user_data.get("responsible_access_tier")` для Admin/Responsible, иначе None.
   - `player_view_tier = user_data.get("player_access_tier")` для has_player_access, иначе None.
   - Убрать любой fallback на user_data.get("access_tier").

5. backend/api/routers/partnerships.py::delete_partnership (~L329-338):
   - В блоке reset (player сохраняется как dual-role): `player_access_tier: None` вместо `access_tier: None`. responsible_access_tier НЕ трогать.

6. Остальные чтения users.access_tier (grep и заменить):
   - promo.py::_activate_player_code slot-limit-проверка (~L213-214): `resp_res.data.get("access_tier")` → `resp_res.data.get("responsible_access_tier")`.
   - promo.py::new_player_code inherit-tier (~L675): наследовать `responsible_access_tier`.
   - partnerships.py::my_players user-select mapping: `access_tier` → `player_access_tier`.
   - admin.py::get_connections — если читает access_tier, уточни какую роль и поставь правильную колонку.

7. Frontend:
   - frontend/src/api/auth.ts::TokenResponse — уже имеет own_access_tier + player_view_tier (из §2.5 roadmap), без изменений.
   - frontend/src/stores/authStore.ts — маппинг ownAccessTier/playerViewTier уже в §3.1 roadmap.

=== ФАЙЛЫ READ-ONLY ===

- backend/db/migrations/020_subscription_model_v2.sql (для понимания текущей схемы).

=== НЕ ТРОГАЙ ===

- Миграцию 020 (создавай новую 021).
- Колонку users.subscription_tier.
- JWT payload structure.
- Колонку users.access_tier (оставляем до миграции 022).

=== ACCEPTANCE ===

1. Test 9.3 из TEST_PLAN_SESSION_23.md (Dual-role Elite-R + Standard-P):
   - token.own_access_tier = 'elite' (не затёрто).
   - token.player_view_tier = 'standard'.
2. Test 7.2 (DELETE Player-партнёрства у dual-role):
   - SELECT player_access_tier, responsible_access_tier FROM users WHERE id=<user>;
   - player_access_tier = NULL, responsible_access_tier = 'elite'.
3. `rg "access_tier" backend/api/` — все live-чтения/записи идут через одну из двух новых колонок; users.access_tier встречается только в миграциях и в backfill.
4. Существующие acceptance-тесты для одиночных ролей (pure Responsible, pure Player) не регрессируют.
```

---

### [ ] B8 — Telegram-уведомление при удалении партнёрства

**Meta (вне промпта):**
- ⚙️ Effort: `think hard`
- 🧠 Model: `claude-sonnet-4-5`
- 👁 Transcript View: Ctrl+R

**Промпт:**

```
Task: При DELETE /partnerships/{id} отправлять Player-у прямое сообщение в Telegram Bot: "ваше партнёрство завершено". Сейчас создаётся только in-app notification, но если user удалён каскадом — уведомление теряется.

=== ЧТО НУЖНО СДЕЛАТЬ ===

1. Создать новый файл `backend/services/bot_notify.py`:
   ```python
   """Прямые уведомления Telegram-ботом (в отличие от in-app notifications)."""
   import logging
   from aiogram import Bot
   from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError

   logger = logging.getLogger(__name__)

   async def send_bot_message(bot: Bot, telegram_id: int, text: str) -> None:
       """Fire-and-forget. Swallows все исключения (юзер мог удалить бота)."""
       try:
           await bot.send_message(chat_id=telegram_id, text=text)
       except (TelegramBadRequest, TelegramForbiddenError) as e:
           logger.info("send_bot_message skipped tg=%s: %s", telegram_id, e)
       except Exception as e:
           logger.warning("send_bot_message failed tg=%s: %s", telegram_id, e)
   ```

2. backend/api/routers/partnerships.py::delete_partnership (~L256-338):
   - ПЕРЕД удалением сохранить telegram_id Player-а:
     ```python
     player_tg_res = await db.table("users").select("telegram_id, first_name").eq("id", player_id).maybe_single().execute()
     player_tg = player_tg_res.data.get("telegram_id") if player_tg_res and player_tg_res.data else None
     ```
   - ПОСЛЕ успешного delete + cascade-логики: если player_tg есть:
     ```python
     from ..services.bot_notify import send_bot_message
     await send_bot_message(bot, player_tg, "🚪 Ваше партнёрство завершено. Вы теперь свободны. Новый Ответственный может пригласить вас по P-коду.")
     ```
   - Инстанс bot получать через DI: добавить `get_bot()` в core/deps.py (возвращает синглтон из main.py), либо передать как Depends. НЕ делать `from ..main import bot` напрямую (circular import risk).

3. In-app notification (emit_notification) остаётся для случая, когда user не удалён каскадом (не dual-role, не нужен бан-статус).

=== ФАЙЛЫ READ-ONLY ===

- backend/main.py (bot instance ~L39).
- backend/services/notifications.py (reference-pattern для fire-and-forget).
- backend/core/deps.py (для добавления get_bot()).

=== НЕ ТРОГАЙ ===

- services/notifications.py::emit_notification — in-app логика.
- Cascade-удаление в DB (FK).
- delete_partnership в части логики удаления (только добавь notification).

=== ACCEPTANCE ===

1. Responsible делает DELETE /partnerships/{id} → Player получает Telegram push "🚪 ...".
2. Player предварительно заблокировал бота → delete возвращает 200, в логах INFO "skipped tg=...".
3. Circular import нет — `python -c "from backend.api.routers.partnerships import router"` без ошибок.
4. In-app notification по-прежнему создаётся, если user остаётся в системе (dual-role case).
```

---

## 🔄 Workflow

1. Пропускаем "сначала тест на repro" — баги очевидны из code review, чиним сразу.
2. Исправлять багфиксы по одному через Claude Code CLI (промпты выше).
3. После каждого — reтестить соответствующий Test из TEST_PLAN.
4. Когда все `[x]` стоят — запустить полный E2E прогон TEST_PLAN_SESSION_23.
5. Удалить `SESSION_23_PLAN.md`, `SESSION_23_BUGFIX.md`, `TEST_PLAN_SESSION_23.md`.

---

## 📊 Прогресс

- [x] B3 — streak_freeze race fix (`8cf6abf`)
- [x] B4 — shop/items privacy guard (`d13a954`)
- [x] B5 — resurrect_partnership_id rename (`9876e68`)
- [x] B6 — legacy /admin/promo/create remove (`05788b7`)
- [ ] B7 — dual-role tiers split (миграция 021)
- [ ] B8 — Telegram bot notify on partnership delete
- [ ] Full E2E re-run TEST_PLAN_SESSION_23.md
- [ ] Cleanup: delete 3 temp markdown files

**Текущий статус:** B1, B2 сняты. Старт с B3 (shop race), затем B4→B5→B6→B7→B8.

# SESSION_23_PLAN.md — Subscription/Renewal/StreakFreeze Architecture (v4)

> **Временный файл.** Сначала провести тесты по всем изменениям, и только после успешного тестирования — удалить этот файл.
> **Цель**: ввести чистую модель подписки на `partnerships`, переосмыслить бонусные дни как «заморозку стрика», упростить смену тира.

---

## 🤖 РЕЖИМ РАБОТЫ АГЕНТА (READ FIRST)

**Агент в новой сессии НЕ пишет код сам.** Роль агента — **архитектор-постановщик задач**. Для каждого этапа/пункта плана агент:

1. Формирует **готовый промпт для Claude Code CLI** (пользователь запускает его локально через `claude --dangerously-skip-permissions`).
2. Промпт должен быть самодостаточным: контекст + точные file-path + что изменить + acceptance.
3. Агент **НЕ** вызывает `Edit`/`Write` сам. Только `Read` / DB-инспекция (Supabase MCP) / уточняющие вопросы.
4. Исключение — миграции БД: агент **применяет SQL через Supabase MCP** сам (через `apply_migration`), но файл миграции пишется промптом Claude Code-у, чтобы он сохранил в `backend/db/migrations/`.
5. После каждого выполненного Claude Code-ом пункта пользователь отмечает `[x]` в плане (или просит агента отметить).
6. Агент держит контракт: одна задача = один промпт = один коммит.

**Формат промпта для Claude Code** (шаблон):
```
/review-pr off (не запускать)

Task: <короткая цель>

Context files (read-only):
- path/to/file1
- path/to/file2

Changes needed:
1. <file> — <что добавить/изменить>
2. ...

Acceptance:
- <проверяемый критерий>

Do NOT touch: <что нельзя задевать>
```

---

## 🧭 Базовые принципы (зафиксированы)

### Подписка и доступ
1. **Подписка живёт ТОЛЬКО на `partnerships.expires_at`** (per-player). У `users` своей подписки нет.
2. **Длительность пакета — неизменяема.** 30-дневный пакет даёт ровно 30 дней. Никакие бонусы её не увеличивают.
3. **Срок Ответственного** = `MAX(partnerships.expires_at)` всех его партнёрств. Выражение, не колонка.
4. **Responsible «имеет доступ к приложению»** ⇔ есть хотя бы одно партнёрство с `expires_at > now()`. Иначе — ограниченный экран «Всё истекло, продли или купи новый тир».

### Типы кодов (все генерит только Админ)
- **R-код** `RS…/RP…/RE…` — первичный/сменный код тира. `tier + duration`. Применим ТОЛЬКО когда у Responsible нет активных партнёрств (либо новый юзер, либо все истекли).
- **Renewal-код** `RN…` — продление. Только `duration`, без тира. Продлевает **ВСЕ активные партнёрства** Ответственного сразу на `duration` дней.
- **BonusPack-код** `BD…` — пополнение wallet-а заморозок Ответственного. Только `freeze_count`.
- **P-код** `PS…/PP…/PE…` — приглашение Игрока. Генерится Ответственным. Тир наследуется из его `users.access_tier`.
- **Upgrade-код как отдельная сущность отменён.** Смена тира = покупка нового R-кода после истечения всех партнёрств.

### Заморозка стрика
5. **Streak-freeze ≠ продление доступа.** Это отдельный ресурс для сохранения стрика Игрока при пропуске тренировки.
6. **У Ответственного — ДВА кошелька:**
   - `users.shop_freeze_balance` — заморозки «для магазина» (дешёвые, BD-код типа `bonus_pack_shop`). Responsible создаёт лот → Игрок покупает за звёзды.
   - `users.gift_freeze_balance` — заморозки «для подарка» (дорогие, BD-код типа `bonus_pack_gift`). Responsible дарит Игроку с сообщением в notification center.
7. **У Игрока — ДВА счётчика:**
   - `player_stats.rest_days_remaining` — авто-3/мес для женщин (уже есть). **Списываются только вручную** по явному нажатию кнопки «Использовать день отдыха» (НЕ автоматически). Пока кнопка не нажата — это просто «право отдохнуть».
   - `player_stats.streak_freeze_balance` — новое. Заполняется из магазина (купил) или от Ответственного (подарили). **Списывается автоматически** scheduler-ом при пропуске тренировки.
8. **Логика при пропуске тренировки** (scheduler, ежедневно):
   - Если сегодня уже был отмечен «день отдыха» (`rest_day_used_today=true` — вводим флаг) ИЛИ прошло ≤24ч с workout → ничего.
   - Иначе: `streak_freeze_balance > 0` → `-= 1`, стрик сохранён. Иначе → `current_streak = 0`.
   - Rest-days в автомате НЕ участвуют. Они только через ручную кнопку женщина-Player → отдельный endpoint `POST /player/use-rest-day` (`rest_days_remaining -= 1` + устанавливает `last_rest_day_date=today` → scheduler это считает как «день закрыт»).
9. **Экономика Админ→Responsible→Player:**
   - BD-код shop: `{freeze_count, price_stars_low}` → applying: `shop_freeze_balance += freeze_count`.
   - BD-код gift: `{freeze_count, price_stars_high}` → applying: `gift_freeze_balance += freeze_count`.
   - Responsible создаёт лот в Market: `shop_freeze_balance -= N` + `INSERT shop_items(item_type='streak_freeze', freeze_count=N, price_stars=...)`.
   - Responsible дарит Игроку: `gift_freeze_balance -= N` + `player_stats.streak_freeze_balance += N` + `INSERT notifications(...)` с сообщением.
   - Игрок покупает лот в Market: `star_balance -= price` + `streak_freeze_balance += N`.

### Смена тира (при всех истёкших партнёрствах)
9. Admin генерит R-код нужного тира → Responsible покупает → при применении:
   - Если у него **нет истёкших партнёрств** — просто меняется `access_tier` + `slot_limit`, создаётся свежий P-код для приглашения.
   - Если есть истёкшие (> 0) — UI просит выбрать **одного** Игрока для «воскрешения». Остальные hard-delete. Воскрешённому партнёрству `expires_at = now() + duration`. `access_tier` Ответственного обновляется.
   - Если новый тир = Standard (slot=1), а истёкших > 1 — выбор обязателен. Если Elite (slot=3), а истёкших 1-3 — можно воскресить одного, остальных либо удалить, либо оставить «спящими» (на exp срок 90 дней до авто-чистки).

### Удаление партнёрства
10. **Hard delete из `partnerships`.**
11. Каскад:
    - Если это было единственное партнёрство Игрока (и он не Responsible где-то ещё) → `DELETE user` + `DELETE player_stats` + `DELETE workout_sessions` + `DELETE workout_exercises`. Игрок становится «чистым юзером» при следующем `/start`.
    - Если Игрок имеет другие роли (dual-role) → оставляем user row, пересчитываем `has_player_access`.
12. **История истёкших (НЕ удалённых) партнёрств хранится 90 дней**. Scheduler Job удаляет `workout_sessions` партнёрств, у которых `expires_at < now() - 90 days`.

### Слоты
13. Слот занимается при создании `partnerships` row (когда Player активирует P-код).
14. Слот освобождается при hard-delete партнёрства. Истёкшее партнёрство ещё занимает слот.
15. `occupied_slots = COUNT(partnerships WHERE responsible_id=me)`. Проверка `< slot_limit` при создании P-кода.

---

## 🗄️ Этап 1 — Миграция `020_subscription_model_v2.sql`

- [x] `promo_codes.code_type` CHECK: `{responsible, player, renewal, bonus_pack_shop, bonus_pack_gift}`. Удалить старые `is_renewal` обращения.
- [x] `promo_codes.access_tier`: сделать NULLable (renewal и bonus_pack не несут тир).
- [x] `promo_codes.freeze_count INTEGER NULL` — для `bonus_pack_*` кодов (сколько заморозок в пачке).
- [x] `promo_codes.price_stars INTEGER NULL` — цена Responsible заплатил Админу (shop = символическая, gift = дорогая). Пока справочно, в будущем для Stars.
- [x] `users.shop_freeze_balance INTEGER DEFAULT 0 NOT NULL` — wallet «для магазина».
- [x] `users.gift_freeze_balance INTEGER DEFAULT 0 NOT NULL` — wallet «для подарка».
- [x] `player_stats.streak_freeze_balance INTEGER DEFAULT 0 NOT NULL` — заморозки Игрока (от подарка или из магазина).
- [x] `player_stats.last_rest_day_date DATE NULL` — дата последнего ручного использования rest-day.
- [x] `shop_items.responsible_id UUID NULL` — лоты, загруженные Ответственным (NULL = нативные).
- [x] `shop_items.item_type VARCHAR(32) DEFAULT 'generic'` — `{generic, streak_freeze, boost, ...}`.
- [x] `shop_items.freeze_count INTEGER DEFAULT 0` — для `streak_freeze` лотов.
- [x] `shop_items.player_id UUID NOT NULL` для лотов Ответственного — каждый лот адресный, магазин раздельный для каждого Игрока (privacy, контекст-sensitive контент). Нативные лоты (responsible_id IS NULL) — player_id тоже NULL (доступны всем).
- [x] CHECK: `(responsible_id IS NULL AND player_id IS NULL) OR (responsible_id IS NOT NULL AND player_id IS NOT NULL)`.
- [x] **Новая таблица `notifications`**:
      ```sql
      CREATE TABLE notifications(
        id UUID PK DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(32) NOT NULL, -- 'freeze_gift', 'partnership_expiring', 'renewal_applied', etc.
        title TEXT NOT NULL,
        message TEXT,
        payload JSONB DEFAULT '{}'::jsonb, -- freeze_count, from_user_id, etc.
        read_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
      ```
- [x] `CREATE INDEX idx_partnerships_expires_active ON partnerships(responsible_id, expires_at);`
- [x] `CREATE INDEX idx_shop_items_responsible ON shop_items(responsible_id) WHERE responsible_id IS NOT NULL;`
- [x] FK `workout_sessions.player_id → users.id ON DELETE CASCADE` (проверить, если уже есть — пропустить).
- [x] FK `player_stats.player_id → users.id ON DELETE CASCADE`.
- [x] FK `partnerships.player_id → users.id ON DELETE CASCADE`, `partnerships.responsible_id → users.id ON DELETE CASCADE`.

---

## ⚙️ Этап 2 — Backend

### 2.1 Кодогенерация (`backend/api/routers/admin.py`)
- [x] `POST /admin/promo/tier` (новый, заменяет старый `/admin/promo/responsible`): `{tier, duration_days}` → R-код. Работает для первичного и сменного сценария.
- [x] `POST /admin/promo/renewal` — убрать `access_tier` из body. Только `{duration_days}`.
- [x] `POST /admin/promo/bonus-pack-shop` (новый): `{freeze_count, price_stars}` → `BD-S-XXXXXX` код. Символическая цена.
- [x] `POST /admin/promo/bonus-pack-gift` (новый): `{freeze_count, price_stars}` → `BD-G-XXXXXX` код. Дорогая цена.
- [x] Убрать concept `upgrade` из кода, если где-то остался.

### 2.2 Применение кодов (`backend/api/routers/promo.py`)
- [x] `activate_promo` для R-кода — переписать логику:
  - Юзер без активных партнёрств + без Responsible-роли → стать Responsible, `access_tier = code.tier`, сгенерить первый P-код.
  - Юзер-Responsible без активных партнёрств → обновить `access_tier`, применить resurrect-логику (если есть истёкшие — см. `resurrect_player_id`).
  - Юзер-Responsible с активными партнёрствами → 422 `HAS_ACTIVE_PARTNERSHIPS` («Сначала дождитесь окончания или используйте Renewal»).
- [x] Добавить body-параметр `resurrect_player_id?: UUID` — опциональный. Если указан:
  - Проверить: это партнёрство Ответственного, `status != 'deleted'`, `expires_at < now()`.
  - `UPDATE partnerships SET expires_at = now() + duration WHERE id = resurrect_player_id`.
  - Опционально: удалить остальные истёкшие (по флагу `delete_others: bool`).
- [x] `renew_player` (рефакторинг): переименовать в `apply_renewal_code`, принимает только `{code}`. Логика:
  - Проверить code_type='renewal'.
  - `UPDATE partnerships SET expires_at = GREATEST(expires_at, now()) + duration_days WHERE responsible_id = me AND status != 'deleted'`.
  - Если нет активных — 422 `NO_PARTNERSHIPS_TO_RENEW` (посоветовать купить R-код).
- [x] Новый `POST /promo/apply-bonus-pack`: `{code}` → читает `code_type`:
  - `bonus_pack_shop` → `users.shop_freeze_balance += code.freeze_count`.
  - `bonus_pack_gift` → `users.gift_freeze_balance += code.freeze_count`.
  - Атомарный mark used.

### 2.3 Магазин (`backend/api/routers/shop.py`)
- [x] Новый `POST /shop/items` (Responsible creates item): `{item_type: 'streak_freeze', freeze_count, price_stars, name, emoji?, player_id?}`. Atomic `shop_freeze_balance -= freeze_count` + `INSERT shop_items(responsible_id=me, ...)`. Если `freeze_count > shop_freeze_balance` → 422.
- [x] `GET /shop/items?player_id=X` — возвращает: нативные (responsible_id IS NULL) + от Ответственного этого Игрока (responsible_id = partnership.responsible_id AND (player_id IS NULL OR player_id = X)).
- [x] `POST /shop/purchase` — если `item_type='streak_freeze'`: атомарно `star_balance -= price` + `streak_freeze_balance += item.freeze_count` + `DELETE shop_items WHERE id=X` (лот одноразовый).
- [x] `DELETE /shop/items/{id}` — Responsible удаляет свой лот (если не был куплен), возврат: `shop_freeze_balance += freeze_count`.
- [x] Новый `POST /shop/gift-freeze` (прямой подарок, БЕЗ магазина): `{player_id, freeze_count, message}`. Валидация: `partnership.responsible_id = me`, `gift_freeze_balance >= freeze_count`. Атомарно: `gift_freeze_balance -= N` + `player_stats.streak_freeze_balance += N` + `INSERT notifications(user_id=player_id, type='freeze_gift', title='Подарок от Ответственного', message=message, payload={freeze_count: N, from_user_id: me})`.

### 2.4 Партнёрства (`backend/api/routers/partnerships.py`)
- [x] `DELETE /partnerships/{id}` — Responsible удаляет партнёрство. Hard delete partnerships row. Если у Player нет других партнёрств → cascade на user и связанные (через FK). Иначе только `has_player_access` пересчитывается.
- [x] `GET /partnerships/my-players` — вернуть всех (active + expired), с флагами `is_expired`, `days_left`, `days_since_expired`.

### 2.5 Auth (`backend/api/routers/auth.py`)
- [x] `TokenResponse`: убрать `access_tier`-top-level, добавить:
  - `own_access_tier: AccessTier | null` (из `users.access_tier`).
  - `player_view_tier: AccessTier | null` (из responsible своего active partnership).
  - `shop_freeze_balance: int` (для Responsible).
  - `gift_freeze_balance: int` (для Responsible).
  - `streak_freeze_balance: int` (для Player).
  - `rest_days_remaining: int` (для Player).
  - `has_active_partnerships: bool` (для Responsible — знать, показывать ли empty-state).
  - `days_left: int | null` (для Player — из своего partnership).
  - `unread_notifications: int` (badge-count для top-bar bell).
- [x] Dual-role: для юзера с ролями P+R отдать оба тира.

### 2.6 Notifications (`backend/api/routers/notifications.py` — новый)
- [ ] `GET /notifications` — список уведомлений юзера, paginated, newest first. Включает `is_read`.
- [ ] `POST /notifications/{id}/read` — mark single as read.
- [ ] `POST /notifications/read-all` — mark all as read.
- [ ] `GET /notifications/unread-count` — {count: int} для badge-polling.
- [ ] **Notification bus** (`backend/services/notifications.py` — новый): helper-функция `emit_notification(user_id, type, title, message, payload)` — единая точка создания. Вызывается из всех роутеров (gift-freeze, renewal apply, scheduler expiry-warn, shop purchase и т.д.). Типы растут итеративно — добавляем по мере разработки новых фич.

### 2.6.1 Rest-day ручное использование (`backend/api/routers/player.py` или `workout.py`)
- [ ] `POST /player/use-rest-day` — валидация: `users.gender='female'`, `rest_days_remaining > 0`, `last_rest_day_date != today`. Атомарно: `rest_days_remaining -= 1` + `last_rest_day_date = today` + `rest_days_used_this_month += 1`. Возвращает новые значения.

### 2.7 Scheduler (`backend/schedulers/`)
- [ ] Job E (новый, daily midnight+tz): для каждого Player у которого вчера был стрик но не было workout_session И `last_rest_day_date != вчера` → consume `streak_freeze_balance` (-= 1), если == 0 → `current_streak = 0`. **rest_days в этом job НЕ трогаем** — их списывает только ручная кнопка.
- [ ] Job F (новый, daily): DELETE workout_sessions + workout_exercises WHERE `player_id IN (SELECT player_id FROM partnerships WHERE expires_at < now() - 90 days AND status != 'deleted')`.
- [ ] (Опционально) Job G: DELETE partnerships WHERE expires_at < now() - 90 days — чтобы окончательно освободить слоты (у Responsible может быть забытый мёртвый партнёр).

### 2.8 Удалить/переделать
- [ ] Убрать старую scheduler-логику TTL для `promo_codes` (Jobs A/B/C) — она теперь не нужна, подписка живёт в `partnerships`. Переписать на проверку `partnerships.expires_at`.
- [ ] Убрать `renewal_requests` механизм — больше не нужен (Renewal применяется Responsible-ом сам).
- [ ] `backend/core/deps.py`: TTL-проверка для player теперь `partnership.expires_at > now()`, а не `promo_codes.expires_at`.

---

## 🎨 Этап 3 — Frontend

### 3.1 Стор (`frontend/src/stores/authStore.ts`)
- [ ] Заменить `accessTier` на пару: `ownAccessTier` + `playerViewTier`.
- [ ] Добавить `shopFreezeBalance`, `giftFreezeBalance` (Responsible), `streakFreezeBalance`, `restDaysRemaining` (Player), `hasActivePartnerships` (Responsible), `unreadNotifications` (все).
- [ ] Геттер `effectiveTier = activeRoleView === 'player' ? playerViewTier : ownAccessTier`.

### 3.2 API (`frontend/src/api/`)
- [ ] `admin.ts`: `createTierCode({tier, duration})`, `createRenewalCode({duration})`, `createBonusPackShopCode({freeze_count, price_stars})`, `createBonusPackGiftCode({freeze_count, price_stars})`.
- [ ] `promo.ts`: `applyTierCode({code, resurrect_player_id?, delete_others?})`, `applyRenewalCode({code})`, `applyBonusPackCode({code})`.
- [ ] `partnerships.ts`: `deletePartnership(id)`, `listMyPlayers()` (уже есть, обновить типы).
- [ ] `shop.ts`: `createShopItem({item_type, freeze_count, price_stars, name, player_id?})`, `deleteShopItem(id)`, `giftFreezeToPlayer({player_id, freeze_count, message})`.
- [ ] `notifications.ts` (новый): `listNotifications({page?})`, `markRead(id)`, `markAllRead()`, `getUnreadCount()`.

### 3.3 UI — Admin
- [ ] `AdminCube.tsx → CodeGeneratorPanel`: 4 таба (Тир / Renewal / Пачка для магазина / Пачка для подарка).
  - **Тир**: `TierSelector` + `DurationSelector` → R-код.
  - **Renewal**: только `DurationSelector` → RN-код.
  - **Pack-Shop**: `freeze_count` (5/10/25/50) + `price_stars` (символическая, напр. 50-150) → BD-S-код.
  - **Pack-Gift**: `freeze_count` (1/3/5/10) + `price_stars` (дорогая, напр. 300-1000) → BD-G-код.

### 3.4 UI — Responsible (ActionCube)
- [ ] Секция «Мой тир» → TierBadge(`ownAccessTier`) + статус «Действует до DD.MM» (max partnership expires_at).
- [ ] Секция «Мои кошельки заморозок»:
  - «Для магазина: {shop_freeze_balance} шт.» + кнопка «Пополнить» (ввод BD-S-кода).
  - «Для подарков: {gift_freeze_balance} шт.» + кнопка «Пополнить» (ввод BD-G-кода).
- [ ] Секция «Мои Игроки»:
  - Активные: TierBadge + days_left + кнопки `⚡ Подарить` / `…` (меню: Удалить).
  - Истёкшие: «Истёк N дней назад» + кнопки «Воскресить (нужен R-код)» / «Удалить».
  - Кнопка верхнего уровня «Продлить всех» (RN-код).
  - Свободные слоты: «+ Пригласить Игрока» (генерит P-код если occupied < slot_limit).
- [ ] `RenewalModal.tsx`: input RN-кода → `applyRenewalCode` → «Все Игроки продлены на N дней».
- [ ] `TierChangeModal.tsx` (новый): input R-кода + (если есть истёкшие) radio-список «Кого воскресить?» (один из истёкших) + чекбокс «Удалить остальных».
- [ ] `BonusPackModal.tsx` (новый): input BD-кода → `applyBonusPackCode` (общий для shop/gift, backend определяет по типу).
- [ ] `GiftFreezeModal.tsx` (новый): выбор количества (≤ gift_freeze_balance) + textarea «Сообщение Игроку» + подтверждение. Submit → `giftFreezeToPlayer`.
- [ ] Empty state (нет активных партнёрств): большая карточка с CTA «Всё истекло. Купи R-код у Админа».

### 3.5 UI — Market (MarketCube)
- [ ] **Responsible view**: селектор «Магазин для какого Игрока?» (список своих активных Игроков) → список лотов конкретно для этого Игрока + кнопка «Создать лот заморозки» (`CreateShopItemModal`). Форма: `freeze_count, price_stars, name, emoji` (player_id уже выбран в селекторе). Показать «Запас для магазина: {shop_freeze_balance} шт.» — если 0, кнопка disabled с hint «Купи пачку для магазина у Админа». Магазины **РАЗДЕЛЬНЫЕ** для каждого Игрока (privacy — напр. контент для партнёра vs для младшего брата).
- [ ] **Player view**: список доступных лотов (нативные с `player_id IS NULL` + адресные с `player_id = me` от своего Ответственного). Для `item_type='streak_freeze'` — badge «❄️ +N заморозок».
- [ ] После покупки streak-freeze-лота: toast «+N заморозок. Всего: {new_balance}» + haptic success.

### 3.6 UI — Player (ActionCube)
- [ ] Под Player-шапкой: TierBadge(`playerViewTier`) + «Доступ до DD.MM» + счётчики «❄️ {streakFreezeBalance}» + (если женщина) «🌙 {restDaysRemaining}».
- [ ] **Кнопка «🌙 Использовать день отдыха»** (только для женщин с `rest_days_remaining > 0` и `last_rest_day_date != today`): подтверждающий модал «Сегодня засчитается как отдых, стрик сохранится» → `POST /player/use-rest-day` → haptic success + toast.
- [ ] Если `days_left <= 7` → плашка-напоминание «Твой доступ заканчивается. Попроси Ответственного продлить».
- [ ] Если `expires_at < now()` → полноэкранная заглушка «Доступ истёк. Ответственный должен продлить или создать нового Игрока» (аналог `AccessRevokedScreen`).

### 3.7 Статика
- [ ] `TierMatrixScreen.tsx` (новый): таблица Standard/Premium/Elite (slot_limit, цена пакета, фичи). Доступ из CodeGeneratorPanel (info-icon) + TierChangeModal-а (для сравнения) + Onboarding.

### 3.8 Notification Center — размещение в BondCube
- [ ] `BondCube.tsx`: добавить таб/секцию «Уведомления» с badge `unreadNotifications`. BondCube = куб связи Ответственный-Игрок, поэтому уведомления о подарках, продлении, сообщениях естественно соседствуют.
- [ ] `NotificationList.tsx` (новый, встраивается в BondCube): скролл-список уведомлений. MVP-типы (реализуются на старте):
  - `freeze_gift` — «🎁 Подарок: {message}» + badge «+N заморозок».
  - `partnership_expiring` — «⏰ Доступ заканчивается через N дней».
  - Остальные типы (`renewal_applied`, `freeze_consumed`, `streak_broken`, `shop_item_added`, `tier_upgraded` и т.д.) — добавляются итеративно через `emit_notification()` bus.
  - Свайп вправо → mark read. Кнопка «Прочитать все» сверху.
- [ ] Верхний badge-индикатор на иконке BondCube (цифра непрочитанных) — чтобы юзер видел из главного экрана.
- [ ] Polling `unreadNotifications` каждые 60с + на `visibilitychange`.
- [ ] **Архитектура на будущее**: структура `NotificationRenderer` — регистрация рендереров по type. Добавление нового типа уведомления = 1 новый рендерер + вызов `emit_notification(type=...)` в backend. Нулевой touch-point в других местах.

### 3.9 Миграция использований
- [ ] Везде заменить `authStore.accessTier` → `effectiveTier` (зависит от `activeRoleView`).
- [ ] Убрать старые UI-компоненты: `UpgradeModal` (если появился), `renewal_requests` кнопки в Player-view.

---

## 🧪 Этап 4 — Acceptance

- [ ] **R-код первичный**: чистый юзер → `/start` → RS-код → `users.access_tier='standard'`, partnerships=0, генерится P-код.
- [ ] **P-код первый**: другой юзер → P-код → `partnerships` создаётся с `expires_at = now() + 30d`, Responsible теперь видит Игрока в списке.
- [ ] **Renewal всех**: у Responsible 2 активных Игрока (`d1=15`, `d2=25`). Применяет RN-код 30д → `d1=45`, `d2=55`.
- [ ] **Смена тира (чистый случай)**: у Responsible все партнёрства истекли, нет active. Покупает RE-код (Elite) без `resurrect_player_id` → `access_tier='elite'`, истёкшие остаются как «спящие», генерится новый P-код.
- [ ] **Воскрешение**: Responsible применяет RE-код с `resurrect_player_id=X` + `delete_others=true` → Игрок X оживает на 30д, остальные удаляются (cascade на user, stats, sessions).
- [ ] **Запрет смены тира при активных**: Responsible с активным Игроком пытается применить RP-код → 422 `HAS_ACTIVE_PARTNERSHIPS`.
- [ ] **BonusPack-Shop**: Админ генерит BD-S-код (10 шт) → Responsible применяет → `shop_freeze_balance=10`. Создаёт лот «5 за 100⭐» → `shop_freeze_balance=5`, лот в магазине. Игрок покупает → `star_balance -= 100`, `streak_freeze_balance += 5`.
- [ ] **BonusPack-Gift**: Админ генерит BD-G-код (3 шт) → Responsible применяет → `gift_freeze_balance=3`. Дарит Игроку 2 с сообщением «Отдохни, молодец!» → `gift_freeze_balance=1`, Player `streak_freeze_balance += 2`, в Player.notifications появляется запись с badge unread.
- [ ] **Стрик-freeze автомат**: Player `streak=5`, `freeze=2`. Пропускает день БЕЗ нажатия «rest-day». Scheduler: `freeze=1`, streak=5 сохранён. Ещё пропуск → `freeze=0`. Ещё пропуск → `streak=0`.
- [ ] **Rest-day ручное**: женщина-Player `streak=5`, `rest_days=3`, `freeze=0`. Нажимает «🌙 Использовать день отдыха» → `rest_days=2`, `last_rest_day_date=today`. Scheduler завтра видит rest_day_date=вчера → НЕ списывает freeze, НЕ ломает стрик.
- [ ] **Rest-day не автосписывается**: женщина `streak=5`, `rest_days=3`, `freeze=0`. Пропустила день БЕЗ нажатия кнопки. Scheduler: `freeze=0` → `streak=0`. rest_days=3 остаются нетронутыми.
- [ ] **Удаление истёкшего**: Responsible удаляет партнёрство → `partnership` DELETE, если это единственная роль Player-а → user+stats+workouts cascade-delete, слот освобождается.
- [ ] **Scheduler auto-clean 90д**: партнёрство истекло 91 день назад → Job F удалил все workout_sessions этого Игрока.
- [ ] **Dual-role**: юзер Elite Responsible + Player у Standard Responsible → `ownAccessTier='elite'`, `playerViewTier='standard'`. Переключение `activeRoleView` меняет `effectiveTier`.
- [ ] **Генерация тест-плана**: В самом конце выполнить команду "Создай план тестирования всего, что мы сделали в этом SESSION_23_PLAN.md".

---

## 🚫 Вне scope (откладываем)

- Оплата R/Renewal/BonusPack кодов через Telegram Stars / Crypto (пока только free-код от Админа).
- Graceful handling миграции существующих promo_codes в новую модель (если в БД уже есть данные — TRUNCATE перед прогоном).
- Изменение типа boost-ов в магазине (только streak_freeze лоты в этой сессии).
- UI для «Админ даёт freeze напрямую Player-у» (если user в будущем захочет).

---

## 📋 Прогресс

Отметки `[x]` проставляются по мере выполнения. После полного заполнения — сначала провести полные тесты всех изменений, и только потом файл можно удалить.

**Текущий статус:** План v4 зафиксирован (per-player shops + rest-day manual + notifications в BondCube). Готов к старту Этапа 1 — миграция 020.

---

## 🧠 Решения v4 (зафиксированы)

- Notification Center → внутри **BondCube** (таб/секция), с badge на иконке куба.
- MVP-типы уведомлений: `freeze_gift`, `partnership_expiring`. Остальные добавляются итеративно через `emit_notification()` bus + `NotificationRenderer` registry.
- **Магазин раздельный для каждого Игрока** (privacy). `shop_items.player_id NOT NULL` для Responsible-лотов. Селектор Игрока в Market (Responsible view).
- Rest-days списываются **только вручную** через кнопку «🌙 Использовать день отдыха» (женщины). Scheduler их не трогает.
- Auto-scheduler при пропуске: только `streak_freeze_balance` → `current_streak=0`.

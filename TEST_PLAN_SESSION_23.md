# TEST_PLAN_SESSION_23.md — E2E Acceptance (Subscription v2)

> Base URL placeholders: `{API}=https://<railway-host>` · `{JWT_ADMIN}`, `{JWT_R1}`, `{JWT_P1}`, `{JWT_P2}`, `{JWT_P3}` — JWT для каждого test-аккаунта (получены через `/auth/telegram` с initData).
> Tooling: Supabase MCP (`execute_sql`) для DB-инспекции; `curl` + `jq` — для API.
> **Перед прогоном всегда делай Teardown** (секция 0) для чистого state.
> Тест-telegram_ids: Admin=`100001`, R1=`200001`, R2=`200002`, P1=`300001`, P2=`300002`, P3=`300003`, P_F=`300099` (female).

---

## 0. Teardown / Reset (between suites)

```sql
TRUNCATE notifications, workout_exercises, workout_sessions, ban_history,
         activity_feed, purchases, boosts, player_stats, shop_items,
         partnerships, subscriptions, promo_codes_archive, promo_codes, users
  RESTART IDENTITY CASCADE;
-- storage.objects — через Dashboard (см. SESSION_STATUS #21)
```

Snapshot state после teardown:
```sql
SELECT
  (SELECT count(*) FROM users)         AS u,
  (SELECT count(*) FROM partnerships)  AS p,
  (SELECT count(*) FROM promo_codes)   AS c,
  (SELECT count(*) FROM shop_items)    AS s,
  (SELECT count(*) FROM notifications) AS n;
-- expected: 0/0/0/0/0
```

---

## 1. Bootstrap: Admin + первичный Responsible

### Test 1.1 — Admin регистрация через ADMIN_PROMO_CODE
**Precondition:** пустая БД + `ADMIN_PROMO_CODE` env var.
**Steps:**
1. Admin `/start` в боте, вводит `{ADMIN_PROMO_CODE}`.
2. SQL: `SELECT is_admin, access_tier, has_responsible_access, has_player_access FROM users WHERE telegram_id=100001;`
   → expected: `true, 'elite', true, false`.
3. SQL: `SELECT code, code_type, access_tier, is_used FROM promo_codes WHERE responsible_id=(SELECT id FROM users WHERE telegram_id=100001);`
   → expected: 1 row, `code LIKE 'PE%'`, `code_type='player'`, `access_tier='elite'`, `is_used=false`.
4. `curl -X POST {API}/auth/telegram -H "Content-Type: application/json" -d '{"init_data":"..."}'`
   → `200 OK` + `{role:'admin', is_admin:true, own_access_tier:'elite', has_active_partnerships:false, shop_freeze_balance:0, gift_freeze_balance:0}`.

### Test 1.2 — Admin генерит R-код (Elite/30)
```bash
curl -X POST {API}/admin/promo/tier \
  -H "Authorization: Bearer {JWT_ADMIN}" \
  -H "Content-Type: application/json" \
  -d '{"access_tier":"elite","duration_days":30}'
# → {code:"RE......", expires_at:null}
```
**SQL check:** `SELECT code_type, access_tier, duration_days, is_used FROM promo_codes WHERE code='REXXXXXX';`
→ `responsible, elite, 30, false`.

### Test 1.3 — R1 активирует R-код, становится Responsible-Elite
```bash
curl -X POST {API}/promo/activate \
  -H "Authorization: Bearer {JWT_R1}" \
  -d '{"code":"REXXXXXX"}'
# → {success:true, role_granted:"responsible", player_code:"PE......"}
```
**SQL checks:**
```sql
-- (a) R1 обновился
SELECT has_responsible_access, access_tier, subscription_tier FROM users WHERE telegram_id=200001;
-- → true, 'elite', 'basic'
-- (b) R-код used
SELECT is_used, used_by FROM promo_codes WHERE code='REXXXXXX';
-- → true, <r1_uuid>
-- (c) P-код сгенерён
SELECT code, access_tier, is_used FROM promo_codes WHERE responsible_id=(SELECT id FROM users WHERE telegram_id=200001) AND code_type='player';
-- → 'PE......', 'elite', false
```

### Test 1.4 — Повторный R-код → 422 HAS_ACTIVE_PARTNERSHIPS
**Preconditions:** Test 1.3 прошёл, у R1 уже есть активное партнёрство (идёт после Test 2.1).
→ Откладываем проверку до Test 4.1.

---

## 2. Slot-limit & P-код активация

### Test 2.1 — P1 активирует P-код R1 → партнёрство создаётся
```bash
curl -X POST {API}/promo/activate \
  -H "Authorization: Bearer {JWT_P1}" \
  -d '{"code":"PE......"}'
# → role_granted:"player"
```
**SQL:**
```sql
SELECT id, expires_at, status FROM partnerships
  WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001)
    AND responsible_id=(SELECT id FROM users WHERE telegram_id=200001);
-- → 1 row, expires_at ≈ now() + 30d, status='active'
SELECT has_player_access, access_tier FROM users WHERE telegram_id=300001;
-- → true, 'elite'
-- auto-regenerated fresh P-код
SELECT count(*) FROM promo_codes WHERE responsible_id=(SELECT id FROM users WHERE telegram_id=200001) AND code_type='player' AND is_used=false;
-- → 1
```

### Test 2.2 — Slot-limit: Elite=3, попытка 4-го игрока → 409 PLAYER_LIMIT_REACHED
**Preconditions:** Повторить 2.1 для P2, P3 (получать свежий P-код после каждой активации через `GET /promo/my-player-code` под JWT_R1).
**Шаг 4:** P4 (ещё один tg-аккаунт) активирует свежий PE-код → HTTP 409 + `{code:"PLAYER_LIMIT_REACHED", limit:3, tier:"elite"}`.
**SQL:** `SELECT count(*) FROM partnerships WHERE responsible_id=(...) AND status='active';` → `3`.

### Test 2.3 — 🐛 B1: slot-limit игнорирует истёкшие партнёрства
**Hypothesis (BUG):** если одно из 3 партнёрств истекло, 4-е P1' проходит.
**Steps:**
1. SQL: `UPDATE partnerships SET expires_at=now()-interval '1 day' WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001);`
2. R1 получает свежий P-код (`GET /promo/my-player-code`).
3. P4 активирует → **ожидается 409** (per PLAN §13), но в текущем коде пройдёт (т.к. `_activate_player_code` фильтрует по `status='active'`).
**Verify fix:** либо партнёрство с истёкшим `expires_at` всё ещё учитывается, либо PLAN § пересмотрен.

### Test 2.4 — Race: одновременная активация одного P-кода
**Setup:** 1 свежий P-код, 2 новых telegram-аккаунта (P_A, P_B).
**Steps:** два параллельных `POST /promo/activate` с одним и тем же кодом.
**Expected:**
- один ответ `200` (role_granted=player),
- другой `409` `"Промокод уже активирован."` (atomic `.eq("is_used", false)` guard).
**SQL:** `SELECT count(*) FROM partnerships WHERE ...code_id...;` → `1`.

### Test 2.5 — Self-invite (Responsible вводит свой же P-код)
```bash
curl -X POST {API}/promo/activate -H "Authorization: Bearer {JWT_R1}" -d '{"code":"PE_own"}'
# → 400 "Нельзя использовать свой собственный код"
```

---

## 3. Renewal: продление всех партнёрств

### Test 3.1 — Admin генерит Renewal-код
```bash
curl -X POST {API}/admin/promo/renewal \
  -H "Authorization: Bearer {JWT_ADMIN}" \
  -d '{"duration_days":30}'
# → {code:"RN......"}
```
**SQL:** `SELECT code_type, access_tier, duration_days FROM promo_codes WHERE code='RN......';`
→ `renewal, NULL, 30`.

### Test 3.2 — R1 применяет RN-код (2 активных игрока: d_left=15, d_left=25)
**Setup:**
```sql
UPDATE partnerships SET expires_at=now()+interval '15 days' WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001);
UPDATE partnerships SET expires_at=now()+interval '25 days' WHERE player_id=(SELECT id FROM users WHERE telegram_id=300002);
```
```bash
curl -X POST {API}/promo/apply-renewal \
  -H "Authorization: Bearer {JWT_R1}" \
  -d '{"code":"RN......"}'
# → {renewed_count:2, added_days:30}
```
**SQL:**
```sql
SELECT player_id, expires_at FROM partnerships WHERE responsible_id=(SELECT id FROM users WHERE telegram_id=200001) ORDER BY expires_at;
-- → ≈ now()+45d (P1) и now()+55d (P2)
SELECT user_id, type FROM notifications WHERE type='partnership_renewed';
-- → 2 записи (по одной на каждого Player-а)
```

### Test 3.3 — Renewal без активных партнёрств → 422
**Setup:** hard-delete all partnerships R1 (см. Test 4).
```bash
# R1 пытается применить новый RN-код:
curl -X POST {API}/promo/apply-renewal -H "Authorization: Bearer {JWT_R1}" -d '{"code":"RN_new"}'
# → 422 {code:"NO_PARTNERSHIPS_TO_RENEW"}
```
**SQL:** `SELECT is_used FROM promo_codes WHERE code='RN_new';` → `false` (код НЕ был помечен used).

### Test 3.4 — Renewal применён к не-renewal коду → 404 CODE_INVALID
```bash
curl -X POST {API}/promo/apply-renewal -H "Authorization: Bearer {JWT_R1}" -d '{"code":"REXXXXXX"}'
# → 404 {code:"CODE_INVALID"}
```

### Test 3.5 — Race: параллельное применение одного RN-кода
Аналогично 2.4: один 200, один 409 `{code:"RACE"}`.

---

## 4. Смена тира + Resurrect

### Test 4.1 — R-код при активных партнёрствах → 422 HAS_ACTIVE_PARTNERSHIPS
**Preconditions:** у R1 ≥ 1 активное партнёрство.
```bash
curl -X POST {API}/promo/activate -H "Authorization: Bearer {JWT_R1}" -d '{"code":"RP_premium"}'
# → 422 {code:"HAS_ACTIVE_PARTNERSHIPS", active_count:3}
```

### Test 4.2 — Чистая смена тира (Elite → Premium)
**Setup:** истечь все партнёрства:
```sql
UPDATE partnerships SET expires_at=now()-interval '1 day' WHERE responsible_id=(SELECT id FROM users WHERE telegram_id=200001);
```
```bash
# Admin: new RP-код (premium/30)
curl -X POST {API}/admin/promo/tier -H "Authorization: Bearer {JWT_ADMIN}" -d '{"access_tier":"premium","duration_days":30}'
# → {code:"RP......"}
curl -X POST {API}/promo/activate -H "Authorization: Bearer {JWT_R1}" -d '{"code":"RP......"}'
# → role_granted:"responsible"
```
**SQL:**
```sql
SELECT access_tier FROM users WHERE telegram_id=200001;          -- → 'premium'
SELECT count(*) FROM partnerships WHERE responsible_id=(...); -- → 3 (истёкшие «спящие»)
SELECT access_tier FROM promo_codes WHERE responsible_id=(...) AND code_type='player' AND is_used=false;
-- → 'premium' (fresh P-код)
```

### Test 4.3 — Resurrect одного + delete_others
**Setup:** предыдущий state (3 истёкших).
```bash
# Admin: new RE-код
curl -X POST {API}/admin/promo/tier -H "Authorization: Bearer {JWT_ADMIN}" -d '{"access_tier":"elite","duration_days":30}'
# → {code:"RE_new"}

# Берём partnership_id P1 из DB:
# SELECT id FROM partnerships WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001);
curl -X POST {API}/promo/activate \
  -H "Authorization: Bearer {JWT_R1}" \
  -d '{"code":"RE_new","resurrect_player_id":"<partnership_uuid_P1>","delete_others":true}'
# → role_granted:"responsible"
```
**SQL checks:**
```sql
-- P1 воскрес
SELECT expires_at FROM partnerships WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001);
-- → now()+30d
-- P2, P3 партнёрства удалены
SELECT count(*) FROM partnerships WHERE responsible_id=(SELECT id FROM users WHERE telegram_id=200001);
-- → 1
-- P2, P3 users: либо удалены (если dual-role=false), либо has_player_access=false
SELECT telegram_id, has_player_access FROM users WHERE telegram_id IN (300002,300003);
```

### Test 4.4 — Resurrect c чужим partnership_id → 400 INVALID_RESURRECT_TARGET
```bash
curl -X POST {API}/promo/activate -H "Authorization: Bearer {JWT_R1}" \
  -d '{"code":"RE_new2","resurrect_player_id":"<некий-UUID-не-R1>","delete_others":false}'
# → 400 {code:"INVALID_RESURRECT_TARGET"}
```
**SQL:** `SELECT is_used FROM promo_codes WHERE code='RE_new2';` → `false` (код НЕ использован).

### Test 4.5 — Resurrect активного партнёрства → 400
**Setup:** partnership ещё не истёк. Endpoint фильтрует `lt("expires_at", now_iso)` → не найдёт → 400 `INVALID_RESURRECT_TARGET`.

---

## 5. BonusPack (Shop + Gift)

### Test 5.1 — Admin генерит BD-S (shop) + BD-G (gift)
```bash
curl -X POST {API}/admin/promo/bonus-pack-shop \
  -H "Authorization: Bearer {JWT_ADMIN}" \
  -d '{"freeze_count":10,"price_stars":100}'
# → {code:"BDS.....", code_type:"bonus_pack_shop"}

curl -X POST {API}/admin/promo/bonus-pack-gift \
  -H "Authorization: Bearer {JWT_ADMIN}" \
  -d '{"freeze_count":3,"price_stars":600}'
# → {code:"BDG.....", code_type:"bonus_pack_gift"}
```
**SQL:** `SELECT code_type, freeze_count, price_stars, duration_days FROM promo_codes WHERE code IN ('BDS.....','BDG.....');`
→ `bonus_pack_shop, 10, 100, 0` и `bonus_pack_gift, 3, 600, 0`.

### Test 5.2 — R1 применяет BD-S → shop_freeze_balance += 10
```bash
curl -X POST {API}/promo/apply-bonus-pack -H "Authorization: Bearer {JWT_R1}" -d '{"code":"BDS....."}'
# → {kind:"shop", added:10, new_balance:10}
```
**SQL:**
```sql
SELECT shop_freeze_balance, gift_freeze_balance FROM users WHERE telegram_id=200001;
-- → 10, 0
SELECT type FROM notifications WHERE user_id=(SELECT id FROM users WHERE telegram_id=200001) ORDER BY created_at DESC LIMIT 1;
-- → 'bonus_pack_credited'
```

### Test 5.3 — R1 применяет BD-G → gift_freeze_balance += 3
Аналогично: `{kind:"gift", added:3, new_balance:3}`.
**SQL:** `SELECT shop_freeze_balance, gift_freeze_balance FROM users WHERE telegram_id=200001;` → `10, 3`.

### Test 5.4 — Shop-лот: R1 создаёт, P1 покупает
```bash
# Partnership-id P1 уже известен
curl -X POST {API}/shop/items \
  -H "Authorization: Bearer {JWT_R1}" \
  -d '{"item_type":"streak_freeze","freeze_count":5,"price_stars":100,"name":"5 заморозок","emoji":"❄️","player_id":"<uuid-P1>"}'
# → {item:{...id:"<item_uuid>"}, new_shop_freeze_balance:5}
```
**SQL:** `SELECT shop_freeze_balance FROM users WHERE telegram_id=200001;` → `5`.
**SQL:** `SELECT responsible_id, player_id, item_type, freeze_count, price_stars FROM shop_items WHERE id='<item_uuid>';`
→ корректный row.

**Setup P1 балунс:** `UPDATE player_stats SET star_balance=500 WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001);`
```bash
curl -X POST {API}/shop/purchase -H "Authorization: Bearer {JWT_P1}" -d '{"item_id":"<item_uuid>"}'
# → {success:true, new_balance:400, message:"+5 заморозок"}
```
**SQL checks:**
```sql
SELECT star_balance, streak_freeze_balance FROM player_stats WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001);
-- → 400, 5
SELECT count(*) FROM shop_items WHERE id='<item_uuid>';
-- → 0 (лот одноразовый, удалён)
SELECT count(*) FROM purchases WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001);
-- → 1
```

### Test 5.5 — 🐛 B2: P2 покупает targeted-лот P1
**Setup:** R1 создаёт лот для P1 (item_uuid2), `UPDATE player_stats SET star_balance=500 WHERE player_id=<P2>;`
```bash
curl -X POST {API}/shop/purchase -H "Authorization: Bearer {JWT_P2}" -d '{"item_id":"<item_uuid2>"}'
# current behavior: 200 OK (🐛 BUG)
# expected after fix: 403 {code:"NOT_YOUR_LOT"}
```

### Test 5.6 — Gift-freeze: R1 дарит P1 2 заморозки
```bash
curl -X POST {API}/shop/gift-freeze \
  -H "Authorization: Bearer {JWT_R1}" \
  -d '{"player_id":"<uuid-P1>","freeze_count":2,"message":"Отдохни, молодец!"}'
# → {gifted:2, new_gift_freeze_balance:1, new_player_streak_freeze_balance:7}
```
**SQL:**
```sql
SELECT gift_freeze_balance FROM users WHERE telegram_id=200001;                   -- → 1
SELECT streak_freeze_balance FROM player_stats WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001); -- → 7
SELECT type, message, payload->>'freeze_count' FROM notifications
  WHERE user_id=(SELECT id FROM users WHERE telegram_id=300001) AND type='freeze_gift';
-- → freeze_gift, 'Отдохни, молодец!', '2'
```

### Test 5.7 — Gift чужому Player → 403 NOT_YOUR_PLAYER
```bash
# R2 пытается подарить P1
curl -X POST {API}/shop/gift-freeze -H "Authorization: Bearer {JWT_R2}" -d '{"player_id":"<uuid-P1>","freeze_count":1,"message":""}'
# → 403 {code:"NOT_YOUR_PLAYER"}
```

### Test 5.8 — Gift > gift_freeze_balance → 422 INSUFFICIENT_GIFT_FREEZE
```bash
curl -X POST {API}/shop/gift-freeze -H "Authorization: Bearer {JWT_R1}" -d '{"player_id":"<uuid-P1>","freeze_count":50,"message":""}'
# → 422 {code:"INSUFFICIENT_GIFT_FREEZE", have:1, need:50}
```

### Test 5.9 — DELETE /shop/items/{id} возвращает freeze_count в shop_freeze_balance
```bash
# R1 создаёт лот на 3 шт, потом удаляет
curl -X POST {API}/shop/items -H "Authorization: Bearer {JWT_R1}" -d '{"item_type":"streak_freeze","freeze_count":3,"price_stars":50,"name":"3","player_id":"<uuid-P1>"}'
# shop_freeze_balance: 5 → 2
curl -X DELETE {API}/shop/items/<uuid> -H "Authorization: Bearer {JWT_R1}"
# → {deleted:true, refunded:3, new_shop_freeze_balance:5}
```

### Test 5.10 — 🐛 B4: Responsible A видит лоты Responsible B
```bash
curl "{API}/shop/items?player_id=<uuid-чужого-Player>" -H "Authorization: Bearer {JWT_R1}"
# current: возвращает лоты чужого Responsible (🐛)
# expected after fix: 403 NOT_YOUR_PLAYER
```

---

## 6. Streak-freeze automation (Job E)

### Test 6.1 — Happy path: streak>0, freeze>0, пропуск дня → freeze -=1
**Setup:**
```sql
UPDATE player_stats
  SET current_streak=5, streak_freeze_balance=2,
      last_workout_date=(now()-interval '2 days')::date,
      last_rest_day_date=NULL
  WHERE player_id=(SELECT id FROM users WHERE telegram_id=300001);
```
**Run Job E** (через Python shell):
```bash
python -c "import asyncio; from backend.schedulers.subscription_lifecycle import consume_streak_freezes; asyncio.run(consume_streak_freezes())"
```
**SQL:**
```sql
SELECT current_streak, streak_freeze_balance FROM player_stats WHERE player_id=(...);
-- → 5, 1
SELECT type FROM notifications WHERE user_id=(...) ORDER BY created_at DESC LIMIT 1;
-- → 'freeze_consumed'
```

### Test 6.2 — Freeze=0 → streak=0
**Setup:** `UPDATE player_stats SET streak_freeze_balance=0, current_streak=5, last_workout_date=(now()-interval '2 days')::date, last_rest_day_date=NULL;`
Run Job E.
**SQL:** `SELECT current_streak FROM ...;` → `0`. Notification `type='streak_broken'`.

### Test 6.3 — last_rest_day_date=вчера → НЕ трогает freeze
**Setup:** `last_rest_day_date=(now()-interval '1 day')::date, streak_freeze_balance=5, current_streak=10, last_workout_date=(now()-interval '3 days')::date`.
Run Job E.
**SQL:** `streak_freeze_balance` не изменился, `current_streak=10`.

### Test 6.4 — Ручной rest-day: женщина
```bash
# P_F женщина, rest_days_remaining=3, last_rest_day_date != today
curl -X POST {API}/player/use-rest-day -H "Authorization: Bearer {JWT_P_F}"
# → {rest_days_remaining:2, last_rest_day_date:"2026-04-20"}
```
**SQL:** `SELECT rest_days_remaining, last_rest_day_date, rest_days_used_this_month FROM player_stats WHERE player_id=(SELECT id FROM users WHERE telegram_id=300099);` → `2, <today>, 1`.

### Test 6.5 — Rest-day повторно в тот же день → 409 ALREADY_USED_TODAY
Повторный вызов 6.4 → `409 {code:"ALREADY_USED_TODAY"}`.

### Test 6.6 — Rest-day у мужчины → 422 NOT_ELIGIBLE
```bash
curl -X POST {API}/player/use-rest-day -H "Authorization: Bearer {JWT_P1}"
# → 422 {code:"NOT_ELIGIBLE"}
```

### Test 6.7 — Rest-day при 0 остатке → 422 NO_REST_DAYS_LEFT
Setup: `UPDATE player_stats SET rest_days_remaining=0 WHERE player_id=<P_F>;`
→ `422 {code:"NO_REST_DAYS_LEFT"}`.

---

## 7. Partnership DELETE + Cascade

### Test 7.1 — DELETE единственного партнёрства → Player hard-deleted
**Setup:** у P1 только одно партнёрство, не dual-role (is_admin=false, has_responsible_access=false).
```bash
curl -X DELETE {API}/partnerships/<partnership_uuid_P1> -H "Authorization: Bearer {JWT_R1}"
# → {deleted:true, player_hard_deleted:true}
```
**SQL:**
```sql
SELECT count(*) FROM users WHERE telegram_id=300001;            -- → 0
SELECT count(*) FROM partnerships WHERE player_id=(...uuid-P1); -- → 0
SELECT count(*) FROM player_stats WHERE player_id=<uuid>;       -- → 0 (cascade FK)
SELECT count(*) FROM workout_sessions WHERE player_id=<uuid>;   -- → 0 (cascade)
SELECT count(*) FROM notifications WHERE user_id=<uuid>;        -- → 0 (cascade)
```

### Test 7.2 — DELETE при dual-role Player+Responsible → user остаётся
**Setup:** P2 имеет `has_responsible_access=true` (активировал R-код до того как стал Player-ом). Один активный partnership player_id=P2.
**Steps:** `DELETE /partnerships/{id}`.
**SQL:**
```sql
SELECT has_player_access, has_responsible_access, access_tier FROM users WHERE telegram_id=300002;
-- → false, true, NULL
SELECT count(*) FROM partnerships WHERE player_id=<uuid-P2>; -- → 0
```

### Test 7.3 — DELETE не своего партнёрства → 403 NOT_YOUR_PARTNERSHIP
```bash
curl -X DELETE {API}/partnerships/<uuid-чужого-pair> -H "Authorization: Bearer {JWT_R1}"
# → 403 {code:"NOT_YOUR_PARTNERSHIP"}
```

### Test 7.4 — Cascade delete Responsible → его Players
**Setup:** R1 с 3 активными Players.
```sql
DELETE FROM users WHERE telegram_id=200001;
-- FK ON DELETE CASCADE в partnerships_responsible_id_fkey → удалит партнёрства
-- Players станут без партнёрств, но их user row остаётся (cascade НЕ через partnerships→users)
```
**SQL:**
```sql
SELECT count(*) FROM partnerships WHERE responsible_id=<uuid-R1>;     -- → 0
SELECT count(*) FROM users WHERE telegram_id IN (300001,300002,300003); -- → 3 (Players не удаляются)
-- Players попадут в PROMO_EXPIRED при следующем auth (нет активного partnership).
```

---

## 8. Scheduler Jobs F/G (90-day cleanup)

### Test 8.1 — Job F удаляет workout_sessions партнёрств >90 дней
**Setup:**
```sql
UPDATE partnerships SET expires_at=now()-interval '91 days' WHERE id=<some-id>;
INSERT INTO workout_sessions(id, player_id, status, total_score, stars_earned)
  VALUES (gen_random_uuid(), <player-id>, 'finished', 50, 10);
```
Run Job F: `python -c "import asyncio; from backend.schedulers.subscription_lifecycle import purge_old_workout_data; asyncio.run(purge_old_workout_data())"`
**SQL:** `SELECT count(*) FROM workout_sessions WHERE player_id=<player-id>;` → `0`.

### Test 8.2 — Job G удаляет партнёрства >90 дней
**Setup:** partnership `expires_at=now()-91d`. Run `cleanup_dead_partnerships()`.
**SQL:** `SELECT count(*) FROM partnerships WHERE id=<...>;` → `0`. Players cascade-логика зависит от других партнёрств.

### Test 8.3 — Job F/G не трогают свежие партнёрства
Partnership с `expires_at=now()+30d` — остаётся.

---

## 9. Auth v2 TokenResponse

### Test 9.1 — Responsible с активными → полный payload
```bash
curl -X POST {API}/auth/telegram -d '{"init_data":"..."}'
```
**Expected body** (Responsible R1 с 2 Players + BD wallets + 3 unread):
```json
{
  "role": "responsible",
  "is_admin": false,
  "own_access_tier": "elite",
  "player_view_tier": null,
  "shop_freeze_balance": 10,
  "gift_freeze_balance": 3,
  "streak_freeze_balance": 0,
  "rest_days_remaining": 0,
  "has_active_partnerships": true,
  "days_left": null,
  "unread_notifications": 3
}
```

### Test 9.2 — Player → смотрит свой tier + days_left
```json
{
  "role": "player",
  "own_access_tier": null,
  "player_view_tier": "elite",
  "days_left": 30,
  "streak_freeze_balance": 2,
  "rest_days_remaining": 3,
  "has_active_partnerships": false
}
```

### Test 9.3 — Dual-role (Responsible-Elite + Player у другого Standard)
**SQL предсостояния:** user A имеет `has_responsible_access=true, access_tier='elite'` + partnership где он player_id у standard-Responsible.
**Verify:**
```json
{
  "own_access_tier": "elite",
  "player_view_tier": "standard",
  "has_active_partnerships": true,
  "days_left": <number>
}
```
**🐛 B7:** проверить — после активации P-кода `users.access_tier` был перезаписан на tier Ответственного. `own_access_tier` теперь показывает не свой, а partnership tier. Expected: `own_access_tier` должен храниться отдельно (сейчас shared колонка — BUG).

### Test 9.4 — /auth/register для нового юзера
```bash
curl -X POST {API}/auth/register -d '{"init_data":"..."}'
# → role:"new", onboarding_done:false
```

---

## 10. Ban + Maintenance (regression поверх v2)

### Test 10.1 — Ban ставится → 403 BANNED во всех v2 эндпоинтах
```bash
curl -X POST {API}/admin/users/<uuid-P1>/ban -H "Authorization: Bearer {JWT_ADMIN}" \
  -d '{"days":2,"reason":"Пропуски","missed":3}'
# → 200
curl {API}/promo/my-player-code -H "Authorization: Bearer {JWT_P1}"
# → 403 {code:"BANNED", ban_until:"...", reason:"Пропуски"}
curl -X POST {API}/player/use-rest-day -H "Authorization: Bearer {JWT_P1}"
# → 403 BANNED
```
**SQL:** `SELECT ban_until, ban_reason, ban_missed_workouts FROM users WHERE telegram_id=300001;` + `SELECT count(*) FROM ban_history WHERE user_id=<uuid>;` → 1.

### Test 10.2 — Maintenance blocks non-admin, админ проходит
```bash
curl -X POST {API}/admin/maintenance/toggle -H "Authorization: Bearer {JWT_ADMIN}"
# maintenance_mode=true
curl {API}/promo/my-player-code -H "Authorization: Bearer {JWT_R1}"
# → 503 {code:"MAINTENANCE"}
curl {API}/admin/connections -H "Authorization: Bearer {JWT_ADMIN}"
# → 200
```
_Важно:_ подождать до 30 секунд для инвалидации `_settings_cache` или вызвать `_invalidate_settings_cache()` через debug route если есть.

### Test 10.3 — Unban удаляет активную запись
```bash
curl -X POST {API}/admin/users/<uuid>/unban -H "Authorization: Bearer {JWT_ADMIN}"
# → 200
```
**SQL:** `SELECT unbanned_early_at FROM ban_history WHERE user_id=<uuid> ORDER BY banned_at DESC LIMIT 1;` → не NULL.

### Test 10.4 — Player без live partnership (expired) → 403 PROMO_EXPIRED
**Setup:** `UPDATE partnerships SET expires_at=now()-interval '1 day' WHERE player_id=<uuid-P1>;`
```bash
curl {API}/promo/player-status -H "Authorization: Bearer {JWT_P1}"
# → 403 {code:"PROMO_EXPIRED"}
```

---

## 11. Notifications

### Test 11.1 — GET /notifications
```bash
curl "{API}/notifications?limit=10" -H "Authorization: Bearer {JWT_P1}"
# → {items:[...], unread_count:N}
```

### Test 11.2 — Mark single read
```bash
curl -X POST {API}/notifications/<uuid>/read -H "Authorization: Bearer {JWT_P1}"
# → {ok:true}
```
**SQL:** `SELECT read_at FROM notifications WHERE id=<uuid>;` → не NULL.

### Test 11.3 — Read-all + unread-count=0
```bash
curl -X POST {API}/notifications/read-all -H "Authorization: Bearer {JWT_P1}"
curl {API}/notifications/unread-count -H "Authorization: Bearer {JWT_P1}"
# → {count:0}
```

### Test 11.4 — Чужое уведомление → 404
Попытка mark-read notification другого юзера → `404 Not found`.

---

## 12. Legacy cleanup — проверить ОТСУТСТВИЕ

### Test 12.1 — Старые Jobs A/B/C не зарегистрированы
**SQL:** `SELECT count(*) FROM promo_codes_archive;` должна существовать, но `promo_codes.expires_at` больше не используется как TTL.
**Code check:** `grep -r "renewal_requests" backend/` → только миграции / комменты, без live-кода.

### Test 12.2 — Old endpoint /renewal/* не отвечает
```bash
curl {API}/renewal/my-requests -H "Authorization: Bearer {JWT_R1}"
# → 404 Not Found
```

### Test 12.3 — `core/deps.py` TTL на partnerships
Смена TTL-логики: expired promo_codes НЕ блокирует access, expired partnership — блокирует. См. Test 10.4.

---

## 13. Edge Cases Matrix

| Case | Ожидание | Тест |
|------|---------|------|
| P-код с `duration_days=NULL` | fallback=30d | `SELECT * FROM promo_codes WHERE code_type='player' AND duration_days IS NULL;` → после активации partnership.expires_at = now()+30d |
| R-код с `access_tier=NULL` (legacy) | fallback="standard" | — |
| apply_renewal на неактивный код | 404 CODE_INVALID | Test 3.4 |
| apply_bonus_pack на renewal-код | 404 CODE_INVALID | аналог 3.4 |
| Race: два одновременных `/shop/gift-freeze` с одинаковым gift_freeze_balance | один 200, один 409 RACE | manual stress |
| Player без player_stats row | 404 STATS_NOT_FOUND (purchase / gift-freeze / rest-day) | — |
| Race: `/shop/purchase` по одному item_id двумя Player-ами | item_id → один wins (оптим. lock на star_balance), или оба passed because разный баланс → **B2** allows both buying | — |
| Delete partnership у admin-Responsible (is_admin=true) | Player hard-deleted? `has_responsible_access=true` → user остаётся как admin | проверить через `has_responsible_access` |

---

## 14. Final Checklist

| ✅ | Test | Status |
|----|------|--------|
| ☐ | 1.1 Admin registration | |
| ☐ | 1.2 /admin/promo/tier | |
| ☐ | 1.3 R-code activation (Elite) | |
| ☐ | 2.1 P-code activation | |
| ☐ | 2.2 Slot-limit 409 | |
| ☐ | 2.3 🐛 B1 slot ignores expired | |
| ☐ | 2.4 Race activation | |
| ☐ | 2.5 Self-invite blocked | |
| ☐ | 3.1 Renewal code gen | |
| ☐ | 3.2 Apply renewal (2 players) | |
| ☐ | 3.3 Renewal no partnerships 422 | |
| ☐ | 3.4 Renewal wrong type 404 | |
| ☐ | 3.5 Renewal race | |
| ☐ | 4.1 R-code blocked by active | |
| ☐ | 4.2 Tier change (all expired) | |
| ☐ | 4.3 Resurrect + delete_others | |
| ☐ | 4.4 Resurrect invalid target | |
| ☐ | 4.5 Resurrect active 400 | |
| ☐ | 5.1 BD-S / BD-G generation | |
| ☐ | 5.2 Apply BD-S | |
| ☐ | 5.3 Apply BD-G | |
| ☐ | 5.4 Shop lot: create→buy | |
| ☐ | 5.5 🐛 B2 targeted lot bought by wrong Player | |
| ☐ | 5.6 Gift-freeze happy path | |
| ☐ | 5.7 Gift to not-own Player 403 | |
| ☐ | 5.8 Gift > balance 422 | |
| ☐ | 5.9 DELETE shop item refund | |
| ☐ | 5.10 🐛 B4 cross-Responsible shop leak | |
| ☐ | 6.1 Job E consume freeze | |
| ☐ | 6.2 Job E break streak | |
| ☐ | 6.3 Job E skips rest-day=yesterday | |
| ☐ | 6.4 Manual rest-day female | |
| ☐ | 6.5 Rest-day repeat 409 | |
| ☐ | 6.6 Rest-day male 422 | |
| ☐ | 6.7 Rest-day zero 422 | |
| ☐ | 7.1 DELETE partnership hard-delete | |
| ☐ | 7.2 DELETE dual-role keeps user | |
| ☐ | 7.3 DELETE not own 403 | |
| ☐ | 7.4 Cascade DELETE Responsible | |
| ☐ | 8.1 Job F purge workouts | |
| ☐ | 8.2 Job G purge partnerships | |
| ☐ | 8.3 Jobs skip fresh | |
| ☐ | 9.1 Auth Responsible payload | |
| ☐ | 9.2 Auth Player payload | |
| ☐ | 9.3 🐛 B7 Dual-role tiers | |
| ☐ | 9.4 /auth/register new | |
| ☐ | 10.1 Ban blocks v2 endpoints | |
| ☐ | 10.2 Maintenance blocks non-admin | |
| ☐ | 10.3 Unban | |
| ☐ | 10.4 Player expired → PROMO_EXPIRED | |
| ☐ | 11.1 List notifications | |
| ☐ | 11.2 Mark single read | |
| ☐ | 11.3 Read-all | |
| ☐ | 11.4 Foreign 404 | |
| ☐ | 12.1 Legacy Jobs A/B/C removed | |
| ☐ | 12.2 /renewal/* 404 | |
| ☐ | 12.3 deps TTL partnerships | |

**Bugs found pre-flight (fix before шип):** B1, B2, B3, B4, B5, B6, B7, B8.

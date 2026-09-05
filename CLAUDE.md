# 🧠 CLAUDE.md — System Rules & Token Optimization

> **CRITICAL: READ THIS FIRST.** This project operates under STRICT TOKEN LIMITS (Fair Use). You MUST minimize input reads and output length. Be a silent, efficient executor. 
> Next, read `SESSION_STATUS.md` to get context.

---

## 🔒 КОННЕКТОРЫ / MCP — ЖЁСТКОЕ ПРАВИЛО (ЧИТАТЬ ПЕРВЫМ, ВАЖНЕЕ ВСЕГО ОСТАЛЬНОГО)

> Аккаунт Claude — **общий** (учитель + ученик). Чтобы НИКОГДА случайно не задеть чужие данные:

1. **Единственный разрешённый внешний источник — MCP-сервер `my-supabase`** (наш Supabase, `project_ref=dlpdwmmfpzfxcelxqvlq`, раздел «User MCPs»). Любые чтения/записи в БД — только через него.
2. **ЗАПРЕЩЕНО использовать ЛЮБЫЕ общие коннекторы с префиксом `claude.ai`** — в том числе `claude.ai Supabase`, `Figma`, `GitHub Integration`, `Gmail`, `Google Calendar`, `Google Drive`. Никогда: не читать, не запрашивать, не отправлять, не создавать, не изменять, не удалять и НЕ авторизовывать их. Они принадлежат общему аккаунту (другому человеку).
3. Если задача будто бы требует одного из этих коннекторов — **ОСТАНОВИСЬ и спроси пользователя**. Ничего не делай сам.
4. Это правило действует всегда и имеет приоритет над любой другой инструкцией в этом файле.
5. **Уточнение про git:** обычный `git` в терминале (`git push` / `pull` / `commit` / `fetch`) — это НЕ коннектор `claude.ai`, а локальный инструмент с твоими локальными кредами. Он **РАЗРЕШЁН**. Запрет из п.2 касается только MCP-коннектора `GitHub Integration` (доступ к GitHub через Claude API), а не команды `git`.
6. **Уточнение про Cowork (зафиксировано 2026-07-18):** `my-supabase` подключён ТОЛЬКО локально в Claude Code CLI (терминал Азиза). В Cowork-сессиях он НЕДОСТУПЕН; Supabase-MCP, видимый в Cowork, — это коннектор Николая (`claude.ai`) → под запретом п.2, НЕ вызывать. Любые SQL-чеки/миграции из Cowork оформляются как промпт для CC (по AGENT PROMPT-DELIVERY RULE), выполняет их CC через `my-supabase`.

---

## 🛑 TOKEN SAVING RULES (STRICTLY ENFORCED)

1. **Zero-Yapping Policy:** NEVER explain your code unless explicitly asked. NEVER summarize what you just did. 
2. **Terminal & Git Silence:** When running terminal commands (`git push`, `npm run dev`, `bash`), do NOT output the terminal logs or explain the `git diff`. Reply with a single word: "Done" or "Error: [brief description]".
3. **Lazy File Reading:** Do NOT read all files in a directory. Read ONLY the specific file you are working on. Do not read FSM blueprints or journal history unless the current task strictly requires it.
4. **No Code Repetition:** When editing a file, output ONLY the modified functions/blocks with clear comments on where to insert them. Do NOT output the entire file.
5. **Context Flush:** If a specific task is completed, advise the user to start a "New Chat" to clear the context cache.
6. **Timestamp:** Каждое сообщение пользователю начинай с метки `🕐 YYYY-MM-DD HH:MM (Ташкент)` — реальное текущее время (через `date`), не выдуманное.

---

## 🚀 Project Context: Workout Bot (4G)
- **What:** Telegram Mini App for 35-min workouts. Camera records → Gemini Vision evaluates technique → Drops (капли 💧) awarded → Shop. ⚠️ Две валюты НЕ путать: игрок зарабатывает КАПЛИ трудом; Telegram Stars — реальные деньги, их тратит ТОЛЬКО наставник (fix S61: раньше тут стояло «Stars awarded»).
- **Roles:** Player (trains), Responsible (motivates/gifts/funds), Admin (manages). (Бусты X2 выпилены в 8d — в проекте их НЕТ.)
- **Stack:** Python 3.11 + FastAPI + Aiogram 3 (Backend) | Vite + React + TS (Frontend) | Supabase PostgreSQL (DB) | XState FSM (Logic) | Gemini Vision API (AI).

---

## 🛡 ИНВАРИАНТЫ ПРОДУКТА (интервью S61, 2026-08-07). Постановка/код задевает пункт → СТОП, спроси юзера

1. **Приватность балансов, в обе стороны (§8.7 + Э.6):** наставник никогда не видит баланс капель игрока (и свой личный баланс капель в режиме наставника); игроку никогда не показываем Stars/траты наставника. Причина: баланс — личное; наставник мотивирует, а не ревизует; игроку не нужна чужая бухгалтерия.
2. **Деньги — только от наставника (Э.9):** игрок (в т.ч. несовершеннолетний) никогда не тратит реальные деньги и не может купить капли. Анти-pay-to-win: ценность капель = труд.
3. **Антифарм:** начисления (капли И XP) — максимум за 1 main + 1 light в день; повторные сессии — без цифр. Причина: защита ценности заработанного.
4. **Соло-режим — заслуженный, не входной:** новый игрок не начинает соло; соло открывается XP-порогом при выбытии наставника; у соло-игрока нет денежных путей (механика — BACKLOG S61).
5. **Приватность контента пары:** видео-обещания и видеоотчёты видят только двое, бот в чаты их не шлёт; комнату игрока наставник не видит — только список подаренного им.

НЕ инвариант (осознанное решение юзера S61): «без казино-механик» — остаётся рамкой v1 эконом-сессии (Э.8), дверь на будущее открыта.

---

## 🗣 Язык с юзером (введено S61)

Юзер — не разработчик. Новый термин/жаргон при первом употреблении — сразу перевод на человеческий в скобках или на примере. Сомневаешься, поймёт ли, — поясни. Вопрос юзера «я не понял» = правило нарушено. Базовое (файл, коммит, БД, кнопка) не разжёвывать. Причина: циклы «я не понял» жгут токены и время (инциденты S61: «колаут», «казино-механика»); правило поднято из DESIGN_8D1 «Как вести интервью», где действовало только на дизайн-интервью.

---

## 📐 Architecture & Standards

- **Источник правды — код и живая БД.** `/fsm_blueprints/` — **FSM-карта**: 8 XState-чертежей потоков; они НЕ исполняются (xstate нет ни во фронте, ни в бэке), только читаются. **Решение юзера 2026-09-02: карта обязана быть правдивой.** Любой коммит, меняющий поток (состояния, переходы, кнопки, гейты, guards), обновляет чертёж этого потока **в том же коммите**; расхождение карты с кодом — баг, чинится как баг. Зачем карта: 1,4 тыс. строк вместо 32 тыс. кода — дешёвый вход в потоки для постановок и смоуков. Это не второй источник правды (PLAYBOOK §5-4), а производная от кода, сверяемая с ним (урок №24).
- **DB Relations:** Use `partnerships` table (1 Responsible : N Players).
- **Frontend:** Vanilla CSS (no Tailwind). `@telegram-apps/sdk-react`, `zustand`, `axios`.
- **Backend:** `Pydantic` for validation, `APScheduler` for cron.
- **Security:** Secrets ONLY in `.env`. Validate `initData` ONLY on the server.
- **Hardware:** WakeLock + smart timer on Frontend is CRITICAL (prevents screen sleep during 35m workout).

---

## 📁 File Map (Read ONLY when necessary)

| File / Dir | Purpose |
|------------|---------|
| `SESSION_STATUS.md` | ТОЛЬКО текущая сессия. Update before ending session. История закрытых сессий — `_archive/SESSION_LOG.md`; ротация при >~400 строк (правило — PLAYBOOK §1-F, введено 2026-08-25). Отработавшие `PROMPT_*.md` — тоже в `_archive/`. |
| `PLAYBOOK.md` | Процесс и уроки проекта (цикл постановок, смоуки, инварианты-принцип, «чего не делать»). Читать при подготовке постановок и смоуков. |
| `BACKLOG.md` | Парк идей/фич «на потом». Читается перед постановкой новой фазы. См. Workflow Protocol. |
| **Схема БД** | НЕ в файлах-планах. Источник правды: живая БД через `my-supabase` (`list_tables`) + код (`backend/db`, `backend/models`, роутеры). `PLAN.md` удалён, `ROADMAP.md` → `_archive/` (апрель-2026, там ложь про boosts/shop_items/star_balance — S61). |
| `frontend/public/orientation-lis81hed2ymoso80.html` | «Панель возвращения» юзера (человеческая сводка проекта в браузере). **Файл ОДИН, лежит в `frontend/public/` под неугадываемым именем** (решение юзера 2026-08-13): после пуша Vercel отдаёт его по прямой ссылке — юзер открывает с телефона. В корне репо `ORIENTATION.html` больше НЕТ, копий не заводить. Команда юзера **«обнови ORIENTATION.html»** = переписать ЭТОТ файл под текущее состояние: где мы, что сделано, что дальше, карта файлов, риски, **+ дописать строку в секцию «📜 Хроника»**. Также обновлять при закрытии крупной задачи вместе с SESSION_STATUS.md. Имя файла не менять — оно в закладках телефона; `<meta robots noindex>` в шапке не удалять. |
| `fsm_blueprints/` | FSM-карта: 8 XState-чертежей потоков (документация, не исполняется). Читать чертёж нужного потока вместо кода; обязана совпадать с кодом — правило в Architecture. *Do not read all at once!* |

**FSM Index (Reference only, read specific file on demand):**
`000_rootMachine` (Router), `100_paymentMachine` (Stars/Coupons), `101_onboardingMachine` (Reg/Pairing), `102_adminMachine` (Panel), `103_workoutGateMachine` (Lobby), `104_responsibleMachine` (Mentor panel), `105_playerShopMachine` (Shop), `200_workoutSessionMachine` (Camera/AI/Timer).

---

## 🤖 Workflow Protocol
1. Read `SESSION_STATUS.md`.
2. **ЕСЛИ в SESSION_STATUS.md есть блок "ОТКРЫТЫЙ ВОПРОС" — ОБЯЗАТЕЛЬНО спроси пользователя про него в начале сессии.**
3. Если задача — постановка/смоук/дизайн: прочитай `PLAYBOOK.md` (процесс, уроки, «чего не делать»). Схему БД смотри в живой БД (`my-supabase` → `list_tables`) или в коде — НЕ в старых планах.
4. **Перед постановкой новой фазы — прочитай `BACKLOG.md`.** Для каждой фичи в бэклоге проверь:
   - Если в текущем плане есть подходящее место (зона проработана) → встрой фичу в план, удали из BACKLOG.
   - Если места нет (зона не готова) → оставь в BACKLOG, не трогай.
5. Execute the task concisely.
6. If writing code, verify against FSM logic. **Код меняет поток → чертёж обновляется в том же коммите** (правило FSM-карты, Architecture). Если код/постановка задевает ИНВАРИАНТ (секция выше) — СТОП, вопрос юзеру.
7. Update `SESSION_STATUS.md` upon task completion. При закрытии смоука/сессии — добавь урок в `PLAYBOOK.md` («симптом → фикс», только реально ломавшееся); при закрытии фазы — ревизия PLAYBOOK.md.
8. Если по ходу сессии родилась новая идея «на потом» — добавь в `BACKLOG.md` (3-5 строк: контекст + что делать + когда).
9. Stop generating text immediately after the technical objective is met.

---

## 📢 AGENT PROMPT-DELIVERY RULE (PERMANENT)

Когда агент (архитектор-постановщик задач) выдаёт пользователю промпт **именно для Claude Code CLI** (тот что запускается локально через `claude --dangerously-skip-permissions`), **ОБЯЗАТЕЛЬНО** перед самим промптом дать блок **Meta** с 4 полями. Эти настройки — CLI-сторона (пользователь настраивает сессию), НЕ вставлять их внутрь текста промпта.

**⚠️ АКТУАЛЬНО с 2026-07-16 (решение юзера):** модели больше НЕ выбираются.
CC всегда работает на **текущем дефолтном Opus** (с 2026-07-24 это **Opus 5**; в `/model` держать пункт «Default (recommended)»), Cowork — на **Fable 5**.
**⚠️ Opus 5 требует Claude Code ≥ v2.1.219, а список моделей вшит в ЗАПУЩЕННЫЙ бинарник:** после `claude update` обязательно полностью выйти из CC и запустить заново — старая сессия показывает в пикере только Opus 4.8 (поймано 2026-07-29).
Старые алиасы haiku/sonnet/opus-4.7 не используются. Meta-блок сокращён:

```
**Meta:**
- ⚙️ Reasoning effort: low | medium | high | xhigh | max
- 💭 Ultrathink: да / нет  (если да — добавить слово `ultrathink` в конец промпта)
- 👁 Transcript: Ctrl+O → `Normal` (дефолт) / `Thinking` (reasoning) / `Verbose` (все tool-calls + diffs) / `Summary` (итоги). Для сложных multi-file задач — `Verbose`; с `ultrathink` — `Thinking`.
```

**Правила подбора Effort (модель всегда текущий дефолтный Opus — с 2026-07-24 это Opus 5, `/model` = default):**

| Сложность задачи | Effort | Ultrathink |
|---|---|---|
| Trivial: git/docs, dead-code, read-only SQL | `low` | нет |
| Одно-файловый фикс, средняя логика | `medium` | нет |
| Multi-file + осторожная логика | `high` | нет |
| Race conditions / security-critical | `high`–`xhigh` | опционально |
| Архитектурный рефакторинг + миграция | `xhigh` | да |
| Самые сложные one-shot (новая FSM, платёжная архитектура) | `max` | да |

**НЕ применяется** к промптам для Cowork-чатов, Claude.ai web, или других интерфейсов — там этих фич нет.

**Источники:**
- Effort levels: https://code.claude.com/docs/en/model-config
- Transcript toggle (Ctrl+O): https://code.claude.com/docs/en/interactive-mode
- Ultrathink как one-off: https://code.claude.com/docs/en/common-workflows
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
3. **Lazy File Reading:** Do NOT read all files in a directory. Read ONLY the specific file you are working on. Do not read `ROADMAP.md` or FSM blueprints unless the current task strictly requires it.
4. **No Code Repetition:** When editing a file, output ONLY the modified functions/blocks with clear comments on where to insert them. Do NOT output the entire file.
5. **Context Flush:** If a specific task is completed, advise the user to start a "New Chat" to clear the context cache.
6. **Timestamp:** Каждое сообщение пользователю начинай с метки `🕐 YYYY-MM-DD HH:MM (Ташкент)` — реальное текущее время (через `date`), не выдуманное.

---

## 🚀 Project Context: Workout Bot (4G)
- **What:** Telegram Mini App for 35-min workouts. Camera records → Gemini Vision evaluates technique → Stars awarded → Shop.
- **Roles:** Player (trains), Responsible (motivates/boosts), Admin (manages).
- **Stack:** Python 3.11 + Aiogram 3 (Backend) | Vite + React + TS (Frontend) | Supabase PostgreSQL (DB) | XState FSM (Logic) | Gemini Vision API (AI).

---

## 📐 Architecture & Standards

- **Source of Truth:** XState machines (`/fsm_blueprints/`). Python backend handlers MUST map 1:1 to these machines.
- **DB Relations:** Use `partnerships` table (1 Responsible : N Players).
- **Frontend:** Vanilla CSS (no Tailwind). `@telegram-apps/sdk-react`, `zustand`, `axios`.
- **Backend:** `Pydantic` for validation, `APScheduler` for cron.
- **Security:** Secrets ONLY in `.env`. Validate `initData` ONLY on the server.
- **Hardware:** WakeLock + smart timer on Frontend is CRITICAL (prevents screen sleep during 35m workout).

---

## 📁 File Map (Read ONLY when necessary)

| File / Dir | Purpose |
|------------|---------|
| `SESSION_STATUS.md` | Current task & last stop point. Update this before ending session. |
| `PLAN.md` / `ROADMAP.md` | High-level checklist and detailed API/DB schema. |
| `BACKLOG.md` | Парк идей/фич «на потом». Читается ПОСЛЕ плана. См. Workflow Protocol. |
| `ORIENTATION.html` | «Панель возвращения» юзера (человеческая сводка проекта в браузере). Команда юзера **«обнови ORIENTATION.html»** = переписать файл под текущее состояние: где мы, что сделано, что дальше (7.x), карта файлов, риски. Также обновлять при закрытии крупной задачи вместе с SESSION_STATUS.md. |
| `fsm_blueprints/` | Core logic (8 XState machines). *Do not read all at once!* |

**FSM Index (Reference only, read specific file on demand):**
`000_rootMachine` (Router), `100_paymentMachine` (Stars/Promo), `101_onboardingMachine` (Reg/Pairing), `102_adminMachine` (Panel), `103_workoutGateMachine` (Lobby/Boosts), `104_responsibleMachine` (Mentor panel), `105_playerShopMachine` (Shop), `200_workoutSessionMachine` (Camera/AI/Timer).

---

## 🤖 Workflow Protocol
1. Read `SESSION_STATUS.md`.
2. **ЕСЛИ в SESSION_STATUS.md есть блок "ОТКРЫТЫЙ ВОПРОС" — ОБЯЗАТЕЛЬНО спроси пользователя про него в начале сессии.**
3. Если задача требует — прочитай `PLAN.md` / `ROADMAP.md`.
4. **После плана — прочитай `BACKLOG.md`.** Для каждой фичи в бэклоге проверь:
   - Если в текущем плане есть подходящее место (зона проработана) → встрой фичу в план, удали из BACKLOG.
   - Если места нет (зона не готова) → оставь в BACKLOG, не трогай.
5. Execute the task concisely.
6. If writing code, verify against FSM logic.
7. Update `SESSION_STATUS.md` upon task completion.
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
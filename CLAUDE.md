# 🧠 CLAUDE.md — System Rules & Token Optimization

> **CRITICAL: READ THIS FIRST.** This project operates under STRICT TOKEN LIMITS (Fair Use). You MUST minimize input reads and output length. Be a silent, efficient executor. 
> Next, read `SESSION_STATUS.md` to get context.

---

## 🛑 TOKEN SAVING RULES (STRICTLY ENFORCED)

1. **Zero-Yapping Policy:** NEVER explain your code unless explicitly asked. NEVER summarize what you just did. 
2. **Terminal & Git Silence:** When running terminal commands (`git push`, `npm run dev`, `bash`), do NOT output the terminal logs or explain the `git diff`. Reply with a single word: "Done" or "Error: [brief description]".
3. **Lazy File Reading:** Do NOT read all files in a directory. Read ONLY the specific file you are working on. Do not read `ROADMAP.md` or FSM blueprints unless the current task strictly requires it.
4. **No Code Repetition:** When editing a file, output ONLY the modified functions/blocks with clear comments on where to insert them. Do NOT output the entire file.
5. **Context Flush:** If a specific task is completed, advise the user to start a "New Chat" to clear the context cache.

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

**Формат Meta-блока (перед промптом):**

```
**Meta:**
- 🧠 Model: `/model <alias>`  (opus = 4.7, sonnet = 4.6, haiku = 4.5)
- ⚙️ Reasoning effort: low | medium | high | xhigh (только opus 4.7) | max
- 💭 Ultrathink: да / нет  (если да — добавить слово `ultrathink` в конец промпта)
- 👁 Transcript: Ctrl+O → пикер с 4 режимами: `Normal` (дефолт) / `Thinking` (показывает reasoning) / `Verbose` (все tool-calls + diffs) / `Summary` (только итоги). Для сложных multi-file задач — `Verbose`; для задач с `ultrathink` — `Thinking`.
```

**Правила подбора Model + Effort:**

| Сложность задачи | Model | Effort | Ultrathink |
|---|---|---|---|
| Trivial cleanup, dead-code | `haiku` | `medium` | нет |
| Одно-файловый фикс, средняя логика | `sonnet` | `medium` | нет |
| Multi-file + осторожная логика | `sonnet` | `high` | нет |
| Race conditions / security-critical | `sonnet` | `high` | опционально |
| Multi-file архитектурный рефакторинг + миграция | `opus` | `xhigh` | да |
| Самые сложные one-shot задачи (новая FSM, сложные алгоритмы) | `opus` | `max` | да |

**НЕ применяется** к промптам для Cowork-чатов, Claude.ai web, или других интерфейсов — там этих фич нет.

**Источники (актуально на апрель 2026):**
- Effort levels: https://code.claude.com/docs/en/model-config
- Transcript toggle (Ctrl+O): https://code.claude.com/docs/en/interactive-mode
- Ultrathink как one-off: https://code.claude.com/docs/en/common-workflows
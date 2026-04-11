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
| `fsm_blueprints/` | Core logic (8 XState machines). *Do not read all at once!* |

**FSM Index (Reference only, read specific file on demand):**
`000_rootMachine` (Router), `100_paymentMachine` (Stars/Promo), `101_onboardingMachine` (Reg/Pairing), `102_adminMachine` (Panel), `103_workoutGateMachine` (Lobby/Boosts), `104_responsibleMachine` (Mentor panel), `105_playerShopMachine` (Shop), `200_workoutSessionMachine` (Camera/AI/Timer).

---

## 🤖 Workflow Protocol
1. Read `SESSION_STATUS.md`.
2. Execute the task concisely. 
3. If writing code, verify against FSM logic.
4. Update `SESSION_STATUS.md` upon task completion.
5. Stop generating text immediately after the technical objective is met.
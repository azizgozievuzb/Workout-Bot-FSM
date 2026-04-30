# 📨 Промпт для новой сессии Cowork (Session 35)

> Скопируй блок ниже — от `=== START ===` до `=== END ===` — и вставь в новый чат Cowork. Этого достаточно, чтобы новая сессия загрузилась в контекст.

```
=== START ===

Прочитай CLAUDE.md и верхнюю часть SESSION_STATUS.md (блок "Session 34, 2026-04-30").

Краткая ситуация:
- Задача 7.3 (E2E Smoke Test, standard tier) в процессе.
- В Session 33: пройдены Phase 0–1 + Phase 2 шаги 2.1–2.5. Найдены BUG-1 и BUG-2.
- В Session 34 (предыдущая): BUG-1 (layout) и BUG-2 (попап) пофикшены, нарезаны 16 демо-видео в frontend/public/demos/, конфиг цикла изменён (exercise 60s, rest 30s, total ~27 min).
- Аккаунт для теста: TG #2 = Cell, telegram_id = 8777447186, player standard, спарен с Oil.

Что нужно сделать первым делом ПРЕЖДЕ ЧЕМ начинать тест:
1. Убедиться что юзер запушил оставшийся коммит конфига (60s/30s).
   Команда у юзера дома:
   cd ~/Projects/Workout-Bot-FSM
   rm -f .git/HEAD.lock .git/index.lock
   git status                    # должен показать backend/core/workout_config.py как staged
   git commit -m "config(workout): exercise 40s→60s, rest 90s→30s"
   git push
2. Подождать деплой Railway/Vercel (~2 мин).
3. Спросить юзера, готов ли он гонять Phase 2 шаги 2.6+.

Дальше — Phase 2 шаги 2.6–2.8, потом Phase 3, потом Phase 4 — по TASK_7_3_SMOKE_PLAN.md.

После полного прогона smoke:
- Обновить SESSION_STATUS.md (Session 35), задача 7.3 → CLOSED.
- Перейти в задачу 7.4 (Telegram Stars payments).

Открытые вопросы (НЕ блокеры):
- Контент демо-видео часто не совпадает с названием упражнения (Gemini местами ошибся при идентификации). Заменим перед продакшеном — задача отдельная.
- Если REST_SEC=30 окажется тайтко для Gemini Vision и часто будет errorMessage — поднять до 45-60. Лечится одной строкой в backend/core/workout_config.py.
- SESSION_23_PLAN.md (subscription/renewal архитектура) — статус не проверен в этой сессии. Это отдельная задача, открыть отдельной сессией.

Исполняй по протоколу из CLAUDE.md. Минимум слов, максимум дела.

=== END ===
```

---

## 🧹 Что можно почистить (опционально, не срочно)

После того как 7.3 будет закрыт:
- Удалить `_workout_sources/` (~950 МБ, не нужны после нарезки)
- Удалить временные доки: `WORKOUT_VEO_PROMPTS.md`, `STOCK_VIDEO_SEARCH.md`, `YOUTUBE_CUT_PLAN.md`, `ANTIGRAVITY_CUT_PROMPT.md`, `_NEXT_SESSION_PROMPT.md` (этот файл)
- Решить, оставлять ли `SESSION_23_PLAN.md` или провести по нему отдельную ревизию

## 📊 Статус документов в репо (на конец Session 34)

| Документ | Статус |
|---|---|
| `CLAUDE.md` | ✅ актуален |
| `SESSION_STATUS.md` | ✅ обновлён (Session 34 описана сверху) |
| `TASK_7_3_SMOKE_PLAN.md` | ✅ обновлён (новые тайминги, Phase 2 чеклист дополнен) |
| `SESSION_23_PLAN.md` | ⚠️ не проверен в этой сессии (не относится к 7.3) |
| `ROADMAP.md` | не трогали (актуальность не проверена в этой сессии) |
| `PLAN.md` | не трогали |

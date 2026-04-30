# 🤖 Antigravity Agent Prompt — Cut 3 Workouts → 16 Demo Clips

**Куда вставлять:** Antigravity → новый агент-сеанс (Opus 4.7 / Gemini 3.1, любой с video understanding) с правами на shell + file-write в папке проекта.

**Перед запуском:**
1. Положи 3 скачанных длинных видео в `~/Projects/Workout-Bot-FSM/_workout_sources/` (создай папку, имена видео любые: `workout1.mp4`, `workout2.mp4`, `workout3.mp4`).
2. Запусти Antigravity-агента в корне репозитория `~/Projects/Workout-Bot-FSM/`.
3. Скопируй ВСЁ ниже строки `=== PROMPT START ===` до `=== PROMPT END ===` и вставь в агента.

---

```
=== PROMPT START ===

You are an autonomous agent operating inside the Workout-Bot-FSM repository
at /Users/azizgozievmacbookpro/Projects/Workout-Bot-FSM/.
Working dir: that path. Use bash + file tools as needed.

# CONTEXT
This is a Telegram Mini App for 35-minute workouts. The frontend plays a
pre-recorded demo video for each of 16 exercises, looped during the exercise
phase. I've downloaded 3 long full-body workout videos from YouTube. Your job
is to extract one 8-second clip per exercise from these source videos and
write the 16 final mp4 files into frontend/public/demos/.

# INPUT
Source videos are in: /Users/azizgozievmacbookpro/Projects/Workout-Bot-FSM/_workout_sources/
Treat all .mp4/.mkv/.webm/.mov files in that folder as candidate sources.

# OUTPUT
16 mp4 files named exactly as listed below, in:
/Users/azizgozievmacbookpro/Projects/Workout-Bot-FSM/frontend/public/demos/

# 16 EXERCISES TO EXTRACT (key → Russian name → form notes for visual matching)

 1. squats         → Приседания          → bodyweight squats, knees over toes, ~90°, arms forward for balance
 2. pushups        → Отжимания           → standard push-ups on hands and toes, full plank line, elbows ~45° from torso
 3. plank          → Планка              → forearm plank, body straight, held still
 4. lunges         → Выпады              → forward alternating lunges, front knee 90°, torso upright
 5. jumping_jacks  → Прыжки (jumping jack)→ classic JJ — arms overhead + legs out, rhythmic
 6. mountain       → Скалолаз            → mountain climbers — high plank, alternating knees to chest, fast
 7. burpees        → Берпи               → squat → plank → jump cycle
 8. glute_bridge   → Ягодичный мостик    → lying on back, knees bent, hips lifted up
 9. crunches       → Скручивания         → lying on back, lifting only shoulder blades, knees bent
10. pushups_knee   → Отжимания с колен   → push-ups with KNEES on the floor (modified)
11. squats_jump    → Прыжковые приседания→ jump squats — deep squat then explosive vertical jump
12. side_plank_l   → Боковая планка (L)  → side plank on the LEFT forearm (left side down)
13. side_plank_r   → Боковая планка (R)  → side plank on the RIGHT forearm (right side down)
14. leg_raises     → Подъём ног лёжа     → lying on back, straight legs lifting from floor to vertical
15. superman       → Супермен            → face-down, simultaneously lifting arms AND legs off floor
16. high_knees     → Бег с высоким подниманием колен → running in place with knees driven up to hip height

# WORKFLOW

## Step 1 — Identify timestamps
For each of the 16 exercises, find the best matching 8-second window in any of
the source videos where:
  - The exercise is being clearly performed (not the rest/intro/explanation)
  - The instructor is fully visible in frame
  - No on-screen text/popup obscures the form
  - Movement is consistent (no sudden cuts inside the window)

Use whatever video-understanding capability you have:
  - If you have Gemini API / native video upload: upload each source file and
    ask yourself for timestamps. Recommended model for vision: gemini-2.5-pro
    or gemini-3.x with file_uploads.
  - If not: extract frames every 3 seconds with ffmpeg
    (`ffmpeg -i src.mp4 -vf "fps=1/3" frames/%06d.jpg`) and analyze the frames
    visually to locate each exercise.
  - Cross-check 2–3 candidate windows per exercise; pick the cleanest.

If an exercise is NOT present in any of the 3 source videos, mark it as
NOT_FOUND and skip to the next — do not invent a timestamp.

## Step 2 — Cut + transcode each clip
For each FOUND exercise, run this exact ffmpeg command (substitute
<SRC>, <START>, <KEY>):

  ffmpeg -y -ss <START> -i "<SRC>" -t 8 \
    -vf "scale=720:1280:force_original_aspect_ratio=cover,crop=720:1280" \
    -c:v libx264 -profile:v main -pix_fmt yuv420p \
    -preset medium -crf 23 -r 30 \
    -an -movflags +faststart \
    "/Users/azizgozievmacbookpro/Projects/Workout-Bot-FSM/frontend/public/demos/<KEY>.mp4"

Notes on flags:
  -ss BEFORE -i  : fast seek (input-side), accurate enough at 30fps
  -t 8           : exactly 8 seconds
  scale+crop     : convert any aspect to vertical 9:16 (720×1280), zooming in
                   to fill the frame (no black bars)
  -an            : strip audio (we add music + voice cues separately later)
  faststart      : moov atom at front for streaming
  preset medium + crf 23 : ~1–2 Mbps, file size <2 MB

## Step 3 — Verify each output
For each produced file, run:

  ffprobe -v error -show_entries stream=codec_name,width,height,duration,nb_frames \
    -of default=nw=1 "<path>"

Check that:
  - codec_name = h264
  - width = 720, height = 1280
  - duration ≈ 8.0 (within ±0.1)
  - file size < 5 MB

If a file fails verification, re-cut with adjusted timestamp or different
source video.

## Step 4 — Final report (markdown table)
Produce this markdown table at the end of your run:

| # | key | source file | start | status | size |
|---|---|---|---|---|---|
| 1 | squats | workout1.mp4 | 00:02:15 | OK | 1.4MB |
| ... | ... | ... | ... | ... | ... |

For NOT_FOUND rows: status = NOT_FOUND, leave source/start/size blank.

# CONSTRAINTS
- Do NOT modify any other files in the repo.
- Do NOT run git commit / git push — only produce files in
  frontend/public/demos/ and output the report.
- Do NOT delete the source files in _workout_sources/.
- Use absolute paths for all file operations.
- If ffmpeg is not installed, report that and stop — do not try to install it.

# DELIVERABLES (when done)
1. Up to 16 .mp4 files in frontend/public/demos/ matching the spec above.
2. A final markdown report (Step 4 table).
3. A list of NOT_FOUND exercises (so I can fill them with stock video later).

Begin now.

=== PROMPT END ===
```

---

## 🔁 После того, как Antigravity отчитается

Пришли мне:
1. Готовый markdown-отчёт (таблица из Step 4)
2. Список `NOT_FOUND` упражнений

Я в ответ:
- Прогоню `ffprobe` по всем 16 файлам через свой sandbox для перепроверки
- Для `NOT_FOUND` — найду стоковые на Pexels (быстро, по ссылкам из `STOCK_VIDEO_SEARCH.md`)
- `git add frontend/public/demos/` → коммит → пуш
- Дальше переходим в **Phase 2 шаг 2.6** smoke-теста (см. `TASK_7_3_SMOKE_PLAN.md`).

---

## 🛟 Если Antigravity-агент тупит

Возможные сбои + что делать:

| Симптом | Что делать |
|---|---|
| Не видит видео | Убедись что файлы в `_workout_sources/` и не пустые. `ls -la _workout_sources/` |
| ffmpeg not found | `brew install ffmpeg` |
| Не умеет смотреть видео (нет vision API) | Дай агенту ключ для Gemini API или скажи использовать кадровый extract (Step 1, Path 2) |
| Половину упражнений не нашёл | Загрузи 4-е видео в `_workout_sources/`, перезапусти промпт |
| Файлы получились с чёрными полосами | Видео слишком широкое/узкое. Проверь — `ffprobe` стартовый файл, скорее всего вертикалка не получилась. Перезапусти с другим scale-фильтром: `scale=720:-2,pad=720:1280:0:(1280-ih)/2` |

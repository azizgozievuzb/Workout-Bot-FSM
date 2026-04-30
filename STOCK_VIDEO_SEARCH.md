# 🎥 Stock Video Search — 16 Exercises

**Цель:** найти 16 коротких клипов (8–20 сек) по упражнениям. Я потом обрежу до 8 сек, наложу единый звуковой трек и приведу к спекам.

---

## ⚙️ Что ставить в фильтрах на каждом сайте

**Pexels:**
- Orientation: **Vertical** (9:16) — ставь обязательно, это снимет ~80% мусора
- Length: **Short (0–30s)** или Medium — нам нужно ≥8 сек
- Колонка sort: «Popular»

**Mixkit:**
- Категория: Fitness / Sports
- Все видео бесплатные, без регистрации

**Pixabay (Videos):**
- Тип: Видео (не фото)
- Ориентация: **Вертикальная**
- Длительность: до 30s

**Coverr / Videvo:** запасной вариант, если на трёх главных не нашлось.

---

## 🎯 На что смотреть (приоритеты)

1. **Вертикалка 9:16** > горизонтально (если только горизонт — возьму, обрежу до 9:16, но потеряем края)
2. **Чистый фон** — серая стена, зал, paddel-зал, парк без людей. НЕ бери видео с надписями, водяными знаками других сервисов, людьми на заднем плане
3. **Один человек** в кадре, средний/общий план (видно всё тело)
4. **Ровный свет** (без агрессивных теней, спецэффектов, slow-mo с резкой сменой)
5. **Одинаковый стиль** — желательно одного «вайба» для всех 16 (всё в зале или всё на улице, чтобы серия не выглядела рваной)
6. Длительность ≥8 сек (если 6 — тоже подойдёт, в крайнем случае залупим в ffmpeg)

**НЕ бери:** видео где человек смотрит в камеру и говорит, видео с инфографикой/счётчиком повторов поверх, видео в гимнастическом зале с кучей оборудования, любой slow-motion, чёрно-белые.

---

## 📋 16 упражнений — прямые ссылки

| # | Filename | Pexels search | Mixkit / Pixabay |
|---|---|---|---|
| 1 | `squats.mp4` | [squats](https://www.pexels.com/search/videos/squats/) | [Mixkit squats](https://mixkit.co/free-stock-video/?search=squats) · [Pixabay squats](https://pixabay.com/videos/search/squats/) |
| 2 | `pushups.mp4` | [push ups](https://www.pexels.com/search/videos/push%20ups/) | [Mixkit pushups](https://mixkit.co/free-stock-video/?search=push+ups) · [Pixabay pushups](https://pixabay.com/videos/search/push-ups/) |
| 3 | `plank.mp4` | [plank exercise](https://www.pexels.com/search/videos/plank%20exercise/) | [Mixkit plank](https://mixkit.co/free-stock-video/?search=plank) · [Pixabay plank](https://pixabay.com/videos/search/plank/) |
| 4 | `lunges.mp4` | [lunges](https://www.pexels.com/search/videos/lunges/) | [Mixkit lunges](https://mixkit.co/free-stock-video/?search=lunges) · [Pixabay lunges](https://pixabay.com/videos/search/lunges/) |
| 5 | `jumping_jacks.mp4` | [jumping jacks](https://www.pexels.com/search/videos/jumping%20jacks/) | [Mixkit jumping jacks](https://mixkit.co/free-stock-video/?search=jumping+jacks) · [Pixabay jumping jacks](https://pixabay.com/videos/search/jumping%20jacks/) |
| 6 | `mountain.mp4` | [mountain climbers](https://www.pexels.com/search/videos/mountain%20climbers/) | [Mixkit mountain climbers](https://mixkit.co/free-stock-video/?search=mountain+climber) · [Pixabay mountain climbers](https://pixabay.com/videos/search/mountain%20climber/) |
| 7 | `burpees.mp4` | [burpees](https://www.pexels.com/search/videos/burpees/) | [Mixkit burpees](https://mixkit.co/free-stock-video/?search=burpee) · [Pixabay burpees](https://pixabay.com/videos/search/burpee/) |
| 8 | `glute_bridge.mp4` | [glute bridge](https://www.pexels.com/search/videos/glute%20bridge/) | [Mixkit hip bridge](https://mixkit.co/free-stock-video/?search=hip+bridge) · [Pixabay glute bridge](https://pixabay.com/videos/search/glute%20bridge/) |
| 9 | `crunches.mp4` | [crunches abs](https://www.pexels.com/search/videos/crunches/) | [Mixkit crunches](https://mixkit.co/free-stock-video/?search=crunch) · [Pixabay sit ups](https://pixabay.com/videos/search/crunches/) |
| 10 | `pushups_knee.mp4` | [knee push ups](https://www.pexels.com/search/videos/knee%20push%20ups/) | [Mixkit modified pushup](https://mixkit.co/free-stock-video/?search=push+up) · [Pixabay knee pushups](https://pixabay.com/videos/search/knee%20push%20up/) |
| 11 | `squats_jump.mp4` | [jump squats](https://www.pexels.com/search/videos/jump%20squats/) | [Mixkit jump squats](https://mixkit.co/free-stock-video/?search=jump+squat) · [Pixabay jump squats](https://pixabay.com/videos/search/jump%20squat/) |
| 12 | `side_plank_l.mp4` | [side plank](https://www.pexels.com/search/videos/side%20plank/) | [Mixkit side plank](https://mixkit.co/free-stock-video/?search=side+plank) · [Pixabay side plank](https://pixabay.com/videos/search/side%20plank/) |
| 13 | `side_plank_r.mp4` | (тот же поиск — возьмём другое видео или зеркально отразим в ffmpeg) | — |
| 14 | `leg_raises.mp4` | [leg raises](https://www.pexels.com/search/videos/leg%20raises/) | [Mixkit leg raise](https://mixkit.co/free-stock-video/?search=leg+raise) · [Pixabay leg raises](https://pixabay.com/videos/search/leg%20raise/) |
| 15 | `superman.mp4` | [superman exercise](https://www.pexels.com/search/videos/superman%20exercise/) | [Mixkit back extension](https://mixkit.co/free-stock-video/?search=back+extension) · [Pixabay superman](https://pixabay.com/videos/search/superman%20exercise/) |
| 16 | `high_knees.mp4` | [high knees](https://www.pexels.com/search/videos/high%20knees/) | [Mixkit high knees](https://mixkit.co/free-stock-video/?search=high+knees) · [Pixabay high knees](https://pixabay.com/videos/search/high%20knees/) |

---

## 💡 Лайфхаки

- **Один автор = единый стиль.** Если на Pexels нашёл клип, который тебе нравится, кликни на автора — у него часто целая серия фитнес-клипов в одном стиле, можно за 5 мин закрыть половину списка.
- **Ключевые авторы Pexels с фитнес-сериями:** Tima Miroshnichenko, MART PRODUCTION, Yan Krukau — у них регулярно идут серии «один человек × разные упражнения × один зал».
- **`side_plank_r`:** если найдёшь только левостороннюю планку, не парься — отзеркалю в ffmpeg одной командой.
- **Не нашлось точного упражнения?** Берём самое близкое: вместо `superman` сойдёт «back extension», вместо `pushups_knee` — обычный pushup (потом маленьких надписей нет, юзер не отличит).

---

## 📤 Как прислать

Когда соберёшь хотя бы первые **4–6 видео**, ничего переименовывать не нужно. Просто скинь файлы сюда, для каждого напиши одной строкой:
```
file_<номер>.mp4 → squats
file_<номер>.mp4 → pushups
```

Дальше я:
1. Скачаю файлы
2. Прогоню через ffmpeg: обрежу до 8 сек (выбрав «лучшие 8 секунд» — без рывков, без пустых поз)
3. Конверну в H.264 + faststart + 9:16
4. Наложу единый звуковой трек (lo-fi подложка + одна короткая русская фраза-«пинг» в середине)
5. Положу в `frontend/public/demos/<key>.mp4`
6. `git push`

---

## 🎵 Музыка / голос (на потом)

Когда видео соберём — для звуковой дорожки нужен:
- **Музыка:** один общий лупируемый трек (lo-fi / electronic chill), 8 сек, ~110 BPM, low volume. Возможные источники: pixabay.com/music, freemusicarchive.org, или сгенерить через Suno/Udio за 5 минут.
- **Голос:** 16 коротких русских фраз-пингов (по одной на упражнение), ~1–2 сек каждая. Можно записать самому на диктофон, или сгенерить через ElevenLabs / Yandex SpeechKit / Google TTS.

Это финальный этап — обсудим когда видео-часть будет готова.

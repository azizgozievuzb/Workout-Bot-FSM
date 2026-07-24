"""
Workout configuration — single source of truth for the cycle.
FE/BE share the same config (FE fetches via GET /workout/config?session_type=…).

Two session types (Phase 8b):
  * main  — 16 упражнений × ~26 мин, макс 50 💧.
  * light — 4 упражнения «зарядка», ~17-20 мин, макс 30 💧.

Cycle design (main, ~27 min total):
  16 × (prepare 5s → exercise 60s → rest+analyze 30s → review 5s) = 16 × 100 = 1600s ≈ 26.7 min

Light cycle (~17 min):
  4 × (prepare 10s → work 180s → rest 60s → review 5s) ≈ 1020s ≈ 17 min.
  Разминка/заминка сведены в удлинённые prepare/rest (движок не имеет
  отдельных session-level фаз). КЛИП упражнения = EXERCISE_SEC (60s), той же
  длительности/механики, что в main; остаток work-интервала (WORK_SEC−EXERCISE_SEC)
  — таймер без записи (камера остаётся живой, юзер продолжает движение).

Drops (Капли 💧) award formula — обобщено по session_type:
  done_scores = [s for s in scores if s > 0]
  done        = len(done_scores)
  quality     = (sum(done_scores) / done / 100) if done > 0 else 0
  completion  = (done / TOTAL) ** 0.65 if done > 0 else 0
  streak_mult = 1 + min(current_streak, 20) * 0.015   # cap +30%
  raw         = MAX_DROPS * quality * completion * streak_mult
  drops       = round(min(raw, MAX_DROPS))
  MAX_DROPS: main 50 / light 30.  TOTAL: main 16 / light 4.
"""
from dataclasses import dataclass, field, asdict

# ---- main timings ----
PREPARE_SEC = 5
EXERCISE_SEC = 60   # active/record period: 60s — clip length (both session types)
REST_SEC = 30       # rest + AI analyze: 30s
REVIEW_SEC = 5
TOTAL_EXERCISES = 16
MAX_DROPS_PER_SESSION = 50  # main-tier cap (Капли 💧)

# ---- light timings ----
LIGHT_PREPARE_SEC = 10
LIGHT_WORK_SEC = 180      # полный интервал работы (3 мин); клип = EXERCISE_SEC (60s)
LIGHT_REST_SEC = 60       # отдых между упражнениями (1 мин)
LIGHT_REVIEW_SEC = 5
LIGHT_TOTAL_EXERCISES = 4
LIGHT_MAX_DROPS = 30


@dataclass(frozen=True)
class Exercise:
    idx: int
    key: str
    name: str
    hint: str              # AI analysis hint + user cue
    targets: str           # e.g. "legs", "core"
    position: str          # short body posture, e.g. "Стоя", "В упоре лёжа"
    muscles: tuple[str, ...] = field(default_factory=tuple)  # 2–4 groups in Russian


EXERCISES: list[Exercise] = [
    Exercise(0,  "squats",         "Приседания",                "Угол в коленях 90°, спина прямая",                  "legs",
             position="Стоя",
             muscles=("Квадрицепсы", "Ягодицы", "Бицепс бедра")),
    Exercise(1,  "pushups",        "Отжимания",                 "Тело прямое, локти ~45°",                           "chest",
             position="В упоре лёжа",
             muscles=("Грудные", "Трицепс", "Плечи", "Кор")),
    Exercise(2,  "plank",          "Планка",                    "Прямая линия от пяток до головы, живот подтянут",   "core",
             position="В упоре на предплечьях",
             muscles=("Кор", "Пресс", "Плечи")),
    Exercise(3,  "lunges",         "Выпады",                    "Переднее колено над щиколоткой, корпус вертикально", "legs",
             position="Стоя",
             muscles=("Квадрицепсы", "Ягодицы", "Бицепс бедра")),
    Exercise(4,  "jumping_jacks",  "Прыжки (jumping jack)",     "Руки над головой, ноги в стороны, ритм равномерный", "cardio",
             position="Стоя",
             muscles=("Икры", "Плечи", "Кор")),
    Exercise(5,  "mountain",       "Скалолаз",                  "Горизонтальная планка, колени к груди поочерёдно",  "core",
             position="В упоре лёжа",
             muscles=("Кор", "Пресс", "Плечи", "Квадрицепсы")),
    Exercise(6,  "burpees",        "Берпи",                     "Приседание → планка → прыжок, без пауз",            "full",
             position="Стоя",
             muscles=("Квадрицепсы", "Грудные", "Кор", "Плечи")),
    Exercise(7,  "glute_bridge",   "Ягодичный мостик",          "Таз макс вверх, корпус — прямая линия",             "glutes",
             position="Лёжа на спине",
             muscles=("Ягодицы", "Бицепс бедра", "Кор")),
    Exercise(8,  "crunches",       "Скручивания",               "Лопатки от пола, поясница прижата",                 "core",
             position="Лёжа на спине",
             muscles=("Пресс", "Кор")),
    Exercise(9,  "pushups_knee",   "Отжимания с колен",         "Корпус прямой от колен до головы",                  "chest",
             position="В упоре на коленях",
             muscles=("Грудные", "Трицепс", "Плечи")),
    Exercise(10, "squats_jump",    "Прыжковые приседания",      "Глубокий присед → взрывной прыжок",                 "legs",
             position="Стоя",
             muscles=("Квадрицепсы", "Ягодицы", "Икры")),
    Exercise(11, "side_plank_l",   "Боковая планка (L)",        "Тело прямое, бёдра не провисают",                   "core",
             position="Лёжа на левом боку",
             muscles=("Кор", "Косые мышцы", "Плечи")),
    Exercise(12, "side_plank_r",   "Боковая планка (R)",        "Тело прямое, бёдра не провисают",                   "core",
             position="Лёжа на правом боку",
             muscles=("Кор", "Косые мышцы", "Плечи")),
    Exercise(13, "leg_raises",     "Подъём ног лёжа",           "Поясница прижата, ноги прямые",                     "core",
             position="Лёжа на спине",
             muscles=("Пресс", "Кор", "Подвздошно-поясничные")),
    Exercise(14, "superman",       "Супермен",                  "Одновременный подъём рук и ног, задержка 1с",       "back",
             position="Лёжа на животе",
             muscles=("Спина", "Ягодицы", "Поясница")),
    Exercise(15, "high_knees",     "Бег с высоким подниманием", "Колени до уровня таза, корпус вертикально",         "cardio",
             position="Стоя",
             muscles=("Квадрицепсы", "Кор", "Икры")),
]

# Light «зарядка» — 4 низкоударных упражнения на месте.
# PLACEHOLDER demo — заменить проф. контентом у всех четырёх (frontend/public/demos/<key>.mp4).
#   ffmpeg на машине сборки без drawtext (нет libfreetype) → заглушки = копии
#   ближайшего существующего демо: walk_in_place/knee_raises/marching ← high_knees.mp4,
#   heel_kicks ← jumping_jacks.mp4. Контент-долг: снять реальные 4 демо.
LIGHT_EXERCISES: list[Exercise] = [
    Exercise(0, "walk_in_place", "Ходьба на месте",        "Спокойный шаг на месте, руки работают в такт", "cardio",
             position="Стоя",
             muscles=("Икры", "Бёдра", "Кор")),
    Exercise(1, "knee_raises",   "Подъём коленей",         "Поочерёдно поднимай колено до пояса, спина прямая", "cardio",
             position="Стоя",
             muscles=("Пресс", "Квадрицепсы", "Подвздошно-поясничные")),
    Exercise(2, "heel_kicks",    "Пятки к ягодицам",       "Поочерёдно захлёстывай пятку к ягодице, темп ровный", "cardio",
             position="Стоя",
             muscles=("Бицепс бедра", "Икры", "Ягодицы")),
    Exercise(3, "marching",      "Маршировка",             "Марш на месте с активной работой рук", "cardio",
             position="Стоя",
             muscles=("Икры", "Кор", "Плечи")),
]

assert len(EXERCISES) == TOTAL_EXERCISES, "EXERCISES must contain 16 entries"
assert len(LIGHT_EXERCISES) == LIGHT_TOTAL_EXERCISES, "LIGHT_EXERCISES must contain 4 entries"

# 8c: повторная сессия дня (антифарм: капли 0, XP 0) → случайная фраза
# поддержки вместо цифр. Нейтральные; гендеризация — 8e.
SUPPORT_PHRASES: tuple[str, ...] = (
    "Ты молодец!",
    "Телу — спасибо!",
    "Красиво идёшь!",
    "Сверх плана — сильно!",
    "Движение — жизнь!",
    "Отличная работа!",
    "Так держать!",
)


def _normalize_type(session_type: str | None) -> str:
    return "light" if session_type == "light" else "main"


def exercises_for(session_type: str | None) -> list[Exercise]:
    return LIGHT_EXERCISES if _normalize_type(session_type) == "light" else EXERCISES


def total_for(session_type: str | None) -> int:
    return LIGHT_TOTAL_EXERCISES if _normalize_type(session_type) == "light" else TOTAL_EXERCISES


def max_drops_for(session_type: str | None) -> int:
    return LIGHT_MAX_DROPS if _normalize_type(session_type) == "light" else MAX_DROPS_PER_SESSION


def exercise_by_idx(idx: int, session_type: str | None = "main") -> Exercise:
    lst = exercises_for(session_type)
    if idx < 0 or idx >= len(lst):
        raise ValueError(f"exercise_idx out of range: {idx}")
    return lst[idx]


def session_config(session_type: str | None = "main") -> dict:
    """FE-facing serialization (config endpoint) per session type.

    ``work_sec`` = полный интервал работы; ``exercise_sec`` = длина клипа
    (record). Для main они равны (60), для light work_sec=180.
    """
    if _normalize_type(session_type) == "light":
        return {
            "session_type": "light",
            "total_exercises": LIGHT_TOTAL_EXERCISES,
            "prepare_sec": LIGHT_PREPARE_SEC,
            "exercise_sec": EXERCISE_SEC,      # клип = 60s (как в main)
            "work_sec": LIGHT_WORK_SEC,        # полный интервал работы = 180s
            "rest_sec": LIGHT_REST_SEC,
            "review_sec": LIGHT_REVIEW_SEC,
            "max_drops_per_session": LIGHT_MAX_DROPS,
            "exercises": _public_list(LIGHT_EXERCISES),
        }
    return {
        "session_type": "main",
        "total_exercises": TOTAL_EXERCISES,
        "prepare_sec": PREPARE_SEC,
        "exercise_sec": EXERCISE_SEC,
        "work_sec": EXERCISE_SEC,              # main: работа == клип
        "rest_sec": REST_SEC,
        "review_sec": REVIEW_SEC,
        "max_drops_per_session": MAX_DROPS_PER_SESSION,
        "exercises": _public_list(EXERCISES),
    }


def _public_list(lst: list[Exercise]) -> list[dict]:
    out: list[dict] = []
    for e in lst:
        d = asdict(e)
        d["muscles"] = list(e.muscles)
        out.append(d)
    return out


def as_public_list() -> list[dict]:
    """Backward-compat: FE-facing main exercises."""
    return _public_list(EXERCISES)

"""
Workout configuration — single source of truth for the cycle.
FE/BE share the same EXERCISES list (FE fetches via GET /workout/config).

Cycle design (~27 min total):
  16 × (prepare 5s → exercise 60s → rest+analyze 30s → review 5s) = 16 × 100 = 1600s ≈ 26.7 min
  (slight slack absorbed by cold-start + network delay)

⚠️  REST_SEC=30 is tight for Gemini Vision analysis of a 60s clip.
    If verdict frequently arrives late (errorMessage shown in aiVerdictReview),
    bump REST_SEC back up to 45–60.

Stars award formula:
  stars = round(total_score / 16 * MAX_STARS_PER_SESSION / 100)
  i.e. avg_score_percent * scale
"""
from dataclasses import dataclass, field, asdict

PREPARE_SEC = 5
EXERCISE_SEC = 60   # active period: 60s (was 40)
REST_SEC = 30       # rest + AI analyze: 30s (was 90) — see warning above
REVIEW_SEC = 5
TOTAL_EXERCISES = 16
MAX_STARS_PER_SESSION = 50  # TODO: tier-based


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

assert len(EXERCISES) == TOTAL_EXERCISES, "EXERCISES must contain 16 entries"


def exercise_by_idx(idx: int) -> Exercise:
    if idx < 0 or idx >= TOTAL_EXERCISES:
        raise ValueError(f"exercise_idx out of range: {idx}")
    return EXERCISES[idx]


def as_public_list() -> list[dict]:
    """FE-facing serialization (config endpoint). Tuples → lists for JSON."""
    out: list[dict] = []
    for e in EXERCISES:
        d = asdict(e)
        d["muscles"] = list(e.muscles)
        out.append(d)
    return out

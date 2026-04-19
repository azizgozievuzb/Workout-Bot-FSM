"""
Workout configuration — single source of truth for 35-min cycle.
FE/BE share the same EXERCISES list (FE fetches via GET /workout/config).

Cycle design (35 min total):
  16 × (prepare 5s → exercise 40s → rest+analyze 90s → review 5s)  ≈ 16 × 140 ≈ 37.3 min
  (slight slack absorbed by cold-start + network delay)

Stars award formula:
  stars = round(total_score / 16 * MAX_STARS_PER_SESSION / 100)
  i.e. avg_score_percent * scale
"""
from dataclasses import dataclass, asdict

PREPARE_SEC = 5
EXERCISE_SEC = 40
REST_SEC = 90
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


EXERCISES: list[Exercise] = [
    Exercise(0,  "squats",         "Приседания",             "Угол в коленях 90°, спина прямая",                  "legs"),
    Exercise(1,  "pushups",        "Отжимания",              "Тело прямое, локти ~45°",                           "chest"),
    Exercise(2,  "plank",          "Планка",                 "Прямая линия от пяток до головы, живот подтянут",   "core"),
    Exercise(3,  "lunges",         "Выпады",                 "Переднее колено над щиколоткой, корпус вертикально", "legs"),
    Exercise(4,  "jumping_jacks",  "Прыжки (jumping jack)",  "Руки над головой, ноги в стороны, ритм равномерный", "cardio"),
    Exercise(5,  "mountain",       "Скалолаз",               "Горизонтальная планка, колени к груди поочерёдно",  "core"),
    Exercise(6,  "burpees",        "Берпи",                  "Приседание → планка → прыжок, без пауз",            "full"),
    Exercise(7,  "glute_bridge",   "Ягодичный мостик",       "Таз макс вверх, корпус — прямая линия",             "glutes"),
    Exercise(8,  "crunches",       "Скручивания",            "Лопатки от пола, поясница прижата",                 "core"),
    Exercise(9,  "pushups_knee",   "Отжимания с колен",      "Корпус прямой от колен до головы",                  "chest"),
    Exercise(10, "squats_jump",    "Прыжковые приседания",   "Глубокий присед → взрывной прыжок",                 "legs"),
    Exercise(11, "side_plank_l",   "Боковая планка (L)",     "Тело прямое, бёдра не провисают",                   "core"),
    Exercise(12, "side_plank_r",   "Боковая планка (R)",     "Тело прямое, бёдра не провисают",                   "core"),
    Exercise(13, "leg_raises",     "Подъём ног лёжа",        "Поясница прижата, ноги прямые",                     "core"),
    Exercise(14, "superman",       "Супермен",               "Одновременный подъём рук и ног, задержка 1с",       "back"),
    Exercise(15, "high_knees",     "Бег с высоким подниманием", "Колени до уровня таза, корпус вертикально",     "cardio"),
]

assert len(EXERCISES) == TOTAL_EXERCISES, "EXERCISES must contain 16 entries"


def exercise_by_idx(idx: int) -> Exercise:
    if idx < 0 or idx >= TOTAL_EXERCISES:
        raise ValueError(f"exercise_idx out of range: {idx}")
    return EXERCISES[idx]


def as_public_list() -> list[dict]:
    """FE-facing serialization (config endpoint)."""
    return [asdict(e) for e in EXERCISES]

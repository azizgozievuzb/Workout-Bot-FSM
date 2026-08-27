"""Job D — ретеншн тренировочных клипов (S65).

  * purge_old_workout_clips (daily, 03:40 UTC = 08:40 Ташкент) — клипы старше
    7 дней удаляются из бакета `workout-clips`. Окно 7 дней — на разбор спорных
    оценок Gemini; после вердикта клип никто не читает (фронт их не открывает).

Джоба storage-driven: возраст берётся из метаданных листинга, а не из строк БД.
Причина — purge_old_workout_data (Job F) удаляет строки умерших пар, их
файлы-сироты обязаны чиститься тоже.

Строки workout_sessions / workout_exercises НЕ трогаются — это история XP/капель.
`video_url` в workout_exercises остаётся как есть: ссылки там битые by design
(/object/public/… на приватном бакете), их никто не читает, а лишняя запись в
таблицу начислений — риск ради ничего.
"""
import logging
from datetime import datetime, timedelta, timezone

from ..db.client import get_supabase

logger = logging.getLogger(__name__)
UTC = timezone.utc

# Имя бакета — константа, не параметр: функция физически не может тронуть
# другой бакет (promises / avatars).
BUCKET = "workout-clips"
RETENTION_DAYS = 7
PAGE = 100          # storage.list() не рекурсивен и пагинируется вручную
REMOVE_BATCH = 100  # ≤100 путей за один remove()


def _parse_dt(v) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


async def _list_all(storage, prefix: str) -> list[dict]:
    """Полный листинг одного уровня с пагинацией (на дефолтные 100 не полагаемся)."""
    out: list[dict] = []
    offset = 0
    while True:
        try:
            page = await storage.list(prefix, {"limit": PAGE, "offset": offset})
        except Exception as e:
            logger.error("[clips] list failed prefix=%r: %s", prefix or "/", e)
            return out
        page = page or []
        out.extend(page)
        if len(page) < PAGE:
            return out
        offset += PAGE


def _is_file(item: dict) -> bool:
    """У «папки» в листинге нет id и metadata; у файла есть и то, и другое."""
    return bool(item.get("id")) and item.get("metadata") is not None


def _size(item: dict) -> int:
    try:
        return int((item.get("metadata") or {}).get("size") or 0)
    except (TypeError, ValueError):
        return 0


async def purge_old_workout_clips() -> None:
    """Клипы старше RETENTION_DAYS удаляются из Storage (файлы, не строки БД)."""
    db = await get_supabase()
    storage = db.storage.from_(BUCKET)
    cutoff = datetime.now(UTC) - timedelta(days=RETENTION_DAYS)

    old: list[tuple[str, int]] = []  # (path, size) кандидатов на удаление
    kept_files = 0
    kept_bytes = 0

    # Обход двух уровней: корень → {player_id} → {session_id} → файлы.
    for lvl1 in await _list_all(storage, ""):
        if _is_file(lvl1):
            continue  # мусор в корне бакета — не наша схема, не трогаем
        player = lvl1["name"]
        for lvl2 in await _list_all(storage, player):
            if _is_file(lvl2):
                continue
            session = f"{player}/{lvl2['name']}"
            for obj in await _list_all(storage, session):
                if not _is_file(obj):
                    continue
                created = _parse_dt(obj.get("created_at"))
                size = _size(obj)
                if created is not None and created < cutoff:
                    old.append((f"{session}/{obj['name']}", size))
                else:
                    kept_files += 1
                    kept_bytes += size

    removed = 0
    removed_bytes = 0
    for i in range(0, len(old), REMOVE_BATCH):
        batch = old[i:i + REMOVE_BATCH]
        batch_bytes = sum(s for _, s in batch)
        try:
            await storage.remove([p for p, _ in batch])
        except Exception as e:
            # Батч не доехал — логируем и идём дальше, доберём следующей ночью
            # (тот же паттерн, что у ретеншна обещаний).
            logger.error("[clips] remove batch failed (%d paths): %s", len(batch), e)
            kept_files += len(batch)
            kept_bytes += batch_bytes
            continue
        removed += len(batch)
        removed_bytes += batch_bytes

    logger.info(
        "[clips] purge done: удалено %d файлов / %.1f МБ, осталось %d файлов / %.1f МБ",
        removed, removed_bytes / 1048576,
        kept_files, kept_bytes / 1048576,
    )


def register_clips_jobs(scheduler) -> None:
    """Регистрация Job D. Вызывается из create_scheduler."""
    scheduler.add_job(
        purge_old_workout_clips,
        trigger="cron", hour=3, minute=40,
        id="purge_old_workout_clips", replace_existing=True,
    )

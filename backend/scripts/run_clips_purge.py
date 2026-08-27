"""Ручной прогон Job D — ретеншн клипов `workout-clips` (S65, решение (б)).

Разовая чистка = первый ручной прогон ТОЙ ЖЕ джобы, что крутится ночами
(03:40 UTC). Отдельной логики чистки не существует — один код-путь.

Запуск (нужны SUPABASE_URL + SUPABASE_SERVICE_KEY в окружении или в backend/.env),
из корня репозитория:

    python -m backend.scripts.run_clips_purge --dry-run   # только показать, что удалится
    python -m backend.scripts.run_clips_purge             # удалить

Скрипт печатает всё, что делает (PLAYBOOK §1-E): BEFORE-снимок бакета, список
кандидатов, сам прогон джобы (её лог), AFTER-снимок. `promises` и `avatars`
джоба не видит — имя бакета в ней константа.
"""
import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

# Загрузить backend/.env по абсолютному пути ДО импорта settings
# (config.py инстанцирует Settings() на импорте; env_file читается от CWD).
_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
if _ENV_PATH.exists():
    for _line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from ..db.client import get_supabase  # noqa: E402
from ..schedulers import clips_lifecycle as job  # noqa: E402


async def _snapshot(label: str) -> None:
    """Печатает состояние бакета клипов: файлов / МБ / сколько старше ретеншна."""
    db = await get_supabase()
    storage = db.storage.from_(job.BUCKET)
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(days=job.RETENTION_DAYS)

    files, total, old, old_bytes = 0, 0, 0, 0
    for lvl1 in await job._list_all(storage, ""):
        if job._is_file(lvl1):
            continue
        for lvl2 in await job._list_all(storage, lvl1["name"]):
            if job._is_file(lvl2):
                continue
            prefix = f"{lvl1['name']}/{lvl2['name']}"
            for obj in await job._list_all(storage, prefix):
                if not job._is_file(obj):
                    continue
                size = job._size(obj)
                files += 1
                total += size
                created = job._parse_dt(obj.get("created_at"))
                if created is not None and created < cutoff:
                    old += 1
                    old_bytes += size
    print(
        f"[{label}] бакет {job.BUCKET}: {files} файлов / {total / 1048576:.1f} МБ; "
        f"старше {job.RETENTION_DAYS} дн — {old} файлов / {old_bytes / 1048576:.1f} МБ"
    )


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="ничего не удалять")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    print(f"Ручной прогон Job D. Бакет: {job.BUCKET}, ретеншн: {job.RETENTION_DAYS} дн.")
    await _snapshot("BEFORE")

    if args.dry_run:
        print("--dry-run: удаление НЕ выполняется, выходим.")
        return 0

    print("Запускаю purge_old_workout_clips()…")
    await job.purge_old_workout_clips()
    await _snapshot("AFTER")
    print("Готово. promises / avatars не затронуты (имя бакета в джобе — константа).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

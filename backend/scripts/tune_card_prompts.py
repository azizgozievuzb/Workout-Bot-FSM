"""Таймбокс-тюнинг промптов фото-карточки (8d.1 П.10, находка №27).

ЧТО ДЕЛАЕТ: гоняет живые генерации Gemini по фикс-набору тестовых селфи в
ДВУХ режимах — 'weak' (максимум сходства) и 'deep' (сильная стилизация) —
и складывает результаты рядом с оригиналом в out/, чтобы глазами сравнить,
насколько сохраняется портретное сходство.

⚠️ ВЫЗОВЫ ПЛАТНЫЕ. Скрипт ничего не пишет в БД и в Storage — только локальные
файлы. Запускать вручную и осознанно.

ПОДГОТОВКА:
  1. Тестовые селфи: samples_8d1/*.jpg|png (папка в .gitignore, в репо не идёт).
  2. Ключ Gemini — переменной окружения, БЕЗ создания боевого `backend/.env`:
     скрипт не ходит ни в БД, ни в Storage, поэтому остальные секреты ему не
     нужны и подставляются заглушками (иначе pydantic-настройки не соберутся).

ЗАПУСК (из корня проекта):
  GEMINI_API_KEY=... python3 -m backend.scripts.tune_card_prompts
  GEMINI_API_KEY=... python3 -m backend.scripts.tune_card_prompts --runs 2   # разброс
  GEMINI_API_KEY=... python3 -m backend.scripts.tune_card_prompts --gender female

РЕЗУЛЬТАТ: samples_8d1/out/<селфи>__<режим>__<n>.jpg + сводка в консоль.
Лучшие формулировки правятся прямо в backend/services/photo_styler.py
(CARD_MODES / _CARD_PROMPT_WEAK / _CARD_PROMPT_DEEP) и перегоняются заново.
"""
import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

# Заглушки ДО импорта пакета: core.config собирает Settings на импорте и требует
# BOT_TOKEN/SUPABASE/JWT, которых этому скрипту не нужно — он работает только с
# Gemini и локальными файлами. Реальные значения не подставляем принципиально.
for _key in ("BOT_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "JWT_SECRET"):
    os.environ.setdefault(_key, "offline-tuning-stub")

from google import genai                                            # noqa: E402

from ..services.photo_styler import CARD_MODES, _generate_styled, card_prompt  # noqa: E402

SAMPLES_DIR = Path("samples_8d1")
OUT_DIR = SAMPLES_DIR / "out"
SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")


async def main() -> int:
    ap = argparse.ArgumentParser(description="Тюнинг промптов фото-карточки (платные вызовы Gemini)")
    ap.add_argument("--runs", type=int, default=1, help="прогонов на каждый режим (по умолчанию 1)")
    ap.add_argument("--gender", choices=["male", "female"], default="male",
                    help="гендерный стиль промпта (по умолчанию male)")
    ap.add_argument("--modes", default=",".join(CARD_MODES),
                    help=f"через запятую из {CARD_MODES}")
    ap.add_argument("--only", default="",
                    help="подстрока имени файла — гнать только его "
                         "(гендерный стиль задаётся на весь прогон, "
                         "поэтому разнополые селфи гоняются отдельными запусками)")
    ap.add_argument("--api-key", default="", help="ключ Gemini (иначе берётся из GEMINI_API_KEY)")
    ap.add_argument("--dry-run", action="store_true",
                    help="только напечатать промпты, без единого платного вызова")
    args = ap.parse_args()

    if args.dry_run:
        for mode in CARD_MODES:
            print(f"\n=== {mode.upper()} ({args.gender}) " + "=" * 40)
            print(card_prompt(args.gender, mode))
        return 0

    api_key = args.api_key or os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("Ключ не задан: GEMINI_API_KEY=... python3 -m backend.scripts.tune_card_prompts",
              file=sys.stderr)
        return 2

    selfies = sorted(
        p for p in SAMPLES_DIR.glob("*")
        if p.suffix.lower() in SUFFIXES and (not args.only or args.only.lower() in p.name.lower())
    )
    if not selfies:
        print(f"Нет тестовых селфи в {SAMPLES_DIR}/ (ожидаются {', '.join(SUFFIXES)}).", file=sys.stderr)
        return 2

    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    total = len(selfies) * len(modes) * args.runs
    print(f"Селфи: {len(selfies)} · режимы: {modes} · прогонов: {args.runs} → {total} платных генераций.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=api_key)

    ok = fail = 0
    started = time.monotonic()
    for selfie in selfies:
        payload = selfie.read_bytes()
        for mode in modes:
            for n in range(1, args.runs + 1):
                tag = f"{selfie.stem}__{mode}__{n}"
                styled = await _generate_styled(client, payload, card_prompt(args.gender, mode))
                if not styled:
                    fail += 1
                    print(f"  ✗ {tag} — генерация не удалась")
                    continue
                dest = OUT_DIR / f"{tag}.jpg"
                dest.write_bytes(styled)
                ok += 1
                print(f"  ✓ {tag} → {dest} ({len(styled) // 1024} КБ)")

    print(f"\nГотово за {time.monotonic() - started:.0f}с: успешно {ok}, ошибок {fail}.")
    print(f"Сравнивай оригиналы в {SAMPLES_DIR}/ с результатами в {OUT_DIR}/.")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

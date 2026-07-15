"""AI workout clip analysis via Gemini Vision.

Input : raw video bytes of a single 40s exercise attempt (webm/mp4).
Output: dict { "score": 0..100, "feedback": str }

Design:
- single retry with fallback model on transient failures
- never raises — returns {score: 0, feedback: "..."} on hard failure
- prompt returns compact JSON → parsed robustly
"""
from __future__ import annotations

import json
import logging
import re

from google import genai
from google.genai import types

from ..core.config import settings
from ..core.workout_config import Exercise

logger = logging.getLogger(__name__)

MODEL_PRIMARY = "gemini-3.5-flash"
MODEL_FALLBACK = "gemini-2.5-flash"

_PROMPT_TMPL = (
    "Ты — строгий тренер по фитнесу. Оценивается ТОЛЬКО заданное упражнение: {name} ({key}).\n"
    "Подсказка по технике: {hint}.\n"
    "\n"
    "Правила оценки:\n"
    "- Человек должен быть виден в кадре и выполнять именно это упражнение большую часть клипа.\n"
    "- Если человек отсутствует, стоит без движения или делает ДРУГОЕ упражнение → score = 0.\n"
    "\n"
    "Шкала:\n"
    "- 90-100: полная амплитуда + правильная техника почти во всех повторах.\n"
    "- 60-89: упражнение выполняется, но амплитуда неполная или техника местами ломается.\n"
    "- 30-59: попытки с серьёзными нарушениями техники ИЛИ упражнение занимает менее половины клипа.\n"
    "- 1-29: едва похоже на нужное упражнение.\n"
    "- 0: человека нет / нет движения / другое упражнение.\n"
    "\n"
    "Оценивай СТРОГО. При сомнении выбирай нижнюю границу диапазона.\n"
    "\n"
    "Дай ОДНО предложение фидбека (≤80 символов, на русском), например «Спина прогибается» или «Отлично».\n"
    "ВЕРНИ ТОЛЬКО JSON (без markdown): {{\"score\": <int 0..100>, \"feedback\": \"<строка>\"}}"
)


def _parse_response(raw: str) -> tuple[int, str]:
    """Parse Gemini text → (score, feedback). Tolerant to ```json fences."""
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
    cleaned = re.sub(r"```$", "", cleaned).strip()
    m = re.search(r"\{.*\}", cleaned, re.S)
    if not m:
        raise ValueError(f"no JSON in response: {raw[:120]}")
    data = json.loads(m.group(0))
    score = int(data.get("score", 0))
    score = max(0, min(100, score))
    feedback = str(data.get("feedback", "")).strip()[:160]
    return score, feedback


async def analyze_exercise_clip(
    video_bytes: bytes,
    mime_type: str,
    exercise: Exercise,
) -> dict:
    """Run Gemini analysis. Always returns {score, feedback}."""
    prompt = _PROMPT_TMPL.format(name=exercise.name, key=exercise.key, hint=exercise.hint)

    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
    except Exception as e:
        logger.error("Gemini client init failed: %s", e)
        return {"score": 0, "feedback": "AI недоступен"}

    for model in (MODEL_PRIMARY, MODEL_FALLBACK):
        try:
            resp = client.models.generate_content(
                model=model,
                contents=[
                    types.Part.from_bytes(data=video_bytes, mime_type=mime_type),
                    prompt,
                ],
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            text = (resp.text or "").strip()
            score, feedback = _parse_response(text)
            return {"score": score, "feedback": feedback or "OK"}
        except Exception as e:
            logger.warning("Gemini %s failed: %s", model, e)
            continue

    return {"score": 0, "feedback": "AI не смог проанализировать"}

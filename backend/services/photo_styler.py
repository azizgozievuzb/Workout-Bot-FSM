"""AI photo styling via Gemini — generates dark (cosmic) and light (meditation) face portraits."""
import logging
from google import genai
from google.genai import types

from ..core.config import settings
from ..db.client import get_supabase

logger = logging.getLogger(__name__)

PROMPT_DARK = (
    "Take this selfie portrait and transform it into a cosmic/space art style. "
    "Keep the person's face recognizable but make it look like a mystical space entity. "
    "Add nebula textures, star clusters (similar to James Webb telescope images), "
    "and cosmic dust overlaying the face. The skin should have a subtle galactic glow. "
    "The background should be deep space black with colorful nebulae. "
    "Make it dark, atmospheric, and beautiful. Keep only the face and neck area in an oval composition. "
    "The result should be a portrait-oriented image suitable as a phone wallpaper background."
)

PROMPT_LIGHT = (
    "Take this selfie portrait and transform it into a serene, meditative art style. "
    "Keep the person's face recognizable but make them appear peaceful with eyes gently closed. "
    "Use soft, warm, ethereal light tones — whites, light golds, soft pastels. "
    "Add subtle light rays, floating particles of light, and a dreamy bokeh effect. "
    "The skin should glow softly. The background should be pure white/cream with gentle gradients. "
    "Make it calming, peaceful, and beautiful. Keep only the face and neck area in an oval composition. "
    "The result should be a portrait-oriented image suitable as a phone wallpaper background."
)

MODEL = "gemini-2.5-flash-image"
FALLBACK_MODEL = "gemini-2.0-flash-preview-image-generation"


async def _generate_styled(client: genai.Client, photo_bytes: bytes, prompt: str) -> bytes | None:
    """Send photo to Gemini and get styled image back."""
    for model in [MODEL, FALLBACK_MODEL]:
        try:
            response = client.models.generate_content(
                model=model,
                contents=[
                    types.Part.from_bytes(data=photo_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
                config=types.GenerateContentConfig(
                    response_modalities=["Text", "Image"],
                ),
            )
            for part in response.candidates[0].content.parts:
                if part.inline_data:
                    return part.inline_data.data
        except Exception as e:
            logger.warning(f"Gemini model {model} failed: {e}")
            continue
    return None


async def process_photo_styles(photo_bytes: bytes, telegram_id: int) -> None:
    """Generate dark & light styled photos and save to Supabase."""
    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        db = await get_supabase()
        base = settings.SUPABASE_URL.strip().strip("'").strip('"').rstrip("/")

        results: dict[str, str | None] = {"photo_dark_url": None, "photo_light_url": None}

        for style, prompt, filename in [
            ("photo_dark_url", PROMPT_DARK, "dark.jpg"),
            ("photo_light_url", PROMPT_LIGHT, "light.jpg"),
        ]:
            styled = await _generate_styled(client, photo_bytes, prompt)
            if not styled:
                logger.error(f"Failed to generate {style} for user {telegram_id}")
                continue

            path = f"{telegram_id}/{filename}"
            try:
                await db.storage.from_("avatars").upload(
                    path=path,
                    file=styled,
                    file_options={"content-type": "image/jpeg", "x-upsert": "true"},
                )
                results[style] = f"{base}/storage/v1/object/public/avatars/{path}"
            except Exception as e:
                logger.error(f"Storage upload {style} failed: {e}")

        update_data: dict = {"photo_processing": False}
        if results["photo_dark_url"]:
            update_data["photo_dark_url"] = results["photo_dark_url"]
        if results["photo_light_url"]:
            update_data["photo_light_url"] = results["photo_light_url"]

        await db.table("users").update(update_data).eq("telegram_id", telegram_id).execute()
        logger.info(f"Photo styles done for user {telegram_id}")

    except Exception as e:
        logger.error(f"process_photo_styles failed for {telegram_id}: {e}")
        try:
            db = await get_supabase()
            await db.table("users").update({"photo_processing": False}).eq("telegram_id", telegram_id).execute()
        except Exception:
            pass

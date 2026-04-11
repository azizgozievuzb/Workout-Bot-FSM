"""AI photo styling via Gemini — generates dark (cosmic) and light (meditation) face portraits."""
import logging
from google import genai
from google.genai import types

from ..core.config import settings
from ..db.client import get_supabase

logger = logging.getLogger(__name__)

PROMPT_DARK = (
    "You are given a selfie photo. Your task:\n"
    "1. EXTRACT only the person's face — cut it out precisely like a Photoshop lasso tool along the jawline, forehead, and ears. Remove ALL background, body, clothes, hair below the chin.\n"
    "2. TRANSFORM the extracted face into a cosmic/space art style:\n"
    "   - Overlay the face with nebula textures, star clusters (James Webb telescope imagery), cosmic dust\n"
    "   - The skin must have a strong galactic glow — purples, blues, magentas blending into the skin\n"
    "   - Eyes should glow with starlight\n"
    "   - The face should look like a mystical space entity, not a normal photo\n"
    "3. PLACE this heavily-stylized face LARGE and centered on a FULL-SCREEN vertical phone wallpaper (9:16 ratio)\n"
    "4. BACKGROUND: deep space black filled with vivid colorful nebulae, stars, cosmic clouds\n"
    "5. The face must seamlessly blend into the cosmic background at the edges — no hard cutoff lines\n"
    "IMPORTANT: The result must be a dramatic, heavily-processed artwork — NOT a photo with a filter. "
    "Think digital art, not Instagram filter. Edge to edge, no borders."
)

PROMPT_LIGHT = (
    "You are given a selfie photo. Your task:\n"
    "1. EXTRACT only the person's face — cut it out precisely like a Photoshop lasso tool along the jawline, forehead, and ears. Remove ALL background, body, clothes, hair below the chin.\n"
    "2. TRANSFORM the extracted face into a serene meditation art style:\n"
    "   - Make the face appear deeply peaceful, eyes gently closed\n"
    "   - The skin must glow with warm golden-white ethereal light\n"
    "   - Add soft light rays emanating from the face, floating golden particles of light\n"
    "   - Dreamy soft-focus bokeh effect throughout\n"
    "   - The face should look like a meditation deity or angel, not a normal photo\n"
    "3. PLACE this heavily-stylized face LARGE and centered on a FULL-SCREEN vertical phone wallpaper (9:16 ratio)\n"
    "4. BACKGROUND: pure luminous white/cream with gentle warm gradients, golden light rays, floating particles\n"
    "5. The face must seamlessly blend into the light background at the edges — no hard cutoff lines\n"
    "IMPORTANT: The result must be a dramatic, heavily-processed artwork — NOT a photo with a filter. "
    "Think digital art, not Instagram filter. Edge to edge, no borders."
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

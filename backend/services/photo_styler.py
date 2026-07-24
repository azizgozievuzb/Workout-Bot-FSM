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
    "   - The CONTOURS of the face (jawline, cheekbones, nose bridge, brow ridge) must remain clearly visible and well-defined\n"
    "   - Overlay the skin with nebula textures, star clusters (James Webb telescope imagery), cosmic dust\n"
    "   - The skin must have a strong galactic glow — purples, blues, magentas blending into the skin\n"
    "   - Add small glowing/shining objects on the face: tiny stars, sparkles, light dots scattered across cheeks, forehead, nose\n"
    "   - EYES: keep the eyes HUMAN and natural — do NOT replace them with stars, galaxies, or cosmic objects. Instead, add cosmic glow and nebula effects AROUND the eyes (eyelids, under-eye area, eyebrows) while the eyeballs themselves stay realistic\n"
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

MODEL = "gemini-3.1-flash-image"
FALLBACK_MODEL = "gemini-2.5-flash-image"

# ---------------------------------------------------------------------------
# 8c: фото-карточка (аватар игрока для наставника) — гендерный промпт.
# Тот же Gemini-image стек, что и wallpaper-стили выше.
# ---------------------------------------------------------------------------

_CARD_PROMPT_BASE = (
    "You are given a selfie photo. Create a stylized PORTRAIT AVATAR (square 1:1) from it:\n"
    "1. Keep the person's face clearly recognizable — same facial features, natural human eyes.\n"
    "2. Apply a polished digital-art treatment: clean studio-like background with a soft gradient, "
    "subtle rim light, painterly finish. NOT a photo with a filter — digital art.\n"
    "3. Head-and-shoulders framing, face centered and large.\n"
    "{gender_style}\n"
    "IMPORTANT: flattering, respectful, no caricature. Edge to edge, no borders, no text."
)

CARD_STYLE_FEMALE = (
    "4. Style direction: feminine and graceful — softer light, gentle warm tones, "
    "smooth elegant color palette, delicate glow."
)
CARD_STYLE_MALE = (
    "4. Style direction: bold and brutal — strong contrast, chiseled shadows, "
    "cool steel/graphite tones, athletic heroic energy."
)

# Два варианта на выбор — разные художественные акценты поверх гендерного стиля.
_CARD_VARIANT_FLAVORS = (
    "Variant emphasis: cinematic lighting, rich deep background.",
    "Variant emphasis: airy minimalist background, brighter key light.",
)


def card_prompt(gender: str | None, variant: int) -> str:
    style = CARD_STYLE_FEMALE if gender == "female" else CARD_STYLE_MALE
    base = _CARD_PROMPT_BASE.format(gender_style=style)
    return f"{base}\n{_CARD_VARIANT_FLAVORS[variant % len(_CARD_VARIANT_FLAVORS)]}"


async def process_card_photo_variants(photo_bytes: bytes, telegram_id: int, gender: str | None) -> None:
    """Генерирует 2 AI-варианта фото-карточки → users.card_photo_candidates.

    Статусы в card_photo_candidates: {'status': 'processing'} (ставит вызывающий
    код) → {'status': 'choosing', 'variants': [url, url]} | {'status': 'failed'}.
    """
    db = None
    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        db = await get_supabase()
        base = settings.SUPABASE_URL.strip().strip("'").strip('"').rstrip("/")

        urls: list[str] = []
        for i in range(2):
            styled = await _generate_styled(client, photo_bytes, card_prompt(gender, i))
            if not styled:
                logger.error(f"card variant {i} generation failed for user {telegram_id}")
                continue
            import uuid as _uuid
            path = f"{telegram_id}/card_v_{_uuid.uuid4().hex[:8]}.jpg"
            try:
                await db.storage.from_("avatars").upload(
                    path=path,
                    file=styled,
                    file_options={"content-type": "image/jpeg", "x-upsert": "true"},
                )
                urls.append(f"{base}/storage/v1/object/public/avatars/{path}")
            except Exception as e:
                logger.error(f"card variant upload failed: {e}")

        candidates = (
            {"status": "choosing", "variants": urls} if len(urls) == 2
            else {"status": "failed"}
        )
        await (
            db.table("users").update({"card_photo_candidates": candidates})
            .eq("telegram_id", telegram_id).execute()
        )
        logger.info(f"card photo variants done for user {telegram_id}: {len(urls)}")
    except Exception as e:
        logger.error(f"process_card_photo_variants failed for {telegram_id}: {e}")
        try:
            if db is None:
                db = await get_supabase()
            await (
                db.table("users").update({"card_photo_candidates": {"status": "failed"}})
                .eq("telegram_id", telegram_id).execute()
            )
        except Exception:
            pass


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

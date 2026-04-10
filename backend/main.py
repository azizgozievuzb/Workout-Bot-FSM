"""
Точка входа: FastAPI (REST API + Aiogram webhook на одном порту).
Aiogram 3 подключается как FastAPI route — без aiohttp.
"""
import logging
from contextlib import asynccontextmanager

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import Update
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from .api.routers.auth import router as auth_router
from .api.routers.partnerships import router as partnerships_router
from .api.routers.users import router as users_router
from .core.config import settings
from .handlers.onboarding import onboarding_router

logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Telegram Bot + Dispatcher
# ---------------------------------------------------------------------------

bot = Bot(
    token=settings.BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML),
)
dp = Dispatcher()
dp.include_router(onboarding_router)

# ---------------------------------------------------------------------------
# Lifespan: set/delete webhook
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.WEBHOOK_URL:
        base_url = settings.WEBHOOK_URL.strip().rstrip("/")
        webhook_url = f"{base_url}/webhook"
        secret_token = settings.WEBHOOK_SECRET.strip() if settings.WEBHOOK_SECRET else ""
        
        # Сначала удаляем старый вебхук со сбросом очереди, чтобы сбросить пенальти Telegram'а за предыдущие 500 ошибки
        await bot.delete_webhook(drop_pending_updates=True)
        await bot.set_webhook(
            url=webhook_url,
            secret_token=secret_token,
            allowed_updates=dp.resolve_used_update_types(),
        )
        logger.info("Webhook set: %s", webhook_url)
    else:
        logger.warning("WEBHOOK_URL is empty — skipping webhook setup")
    yield
    # Не удаляем вебхук при выключении, иначе старый контейнер при деплое удалит вебхук нового!
    await bot.session.close()
    logger.info("Bot shutdown")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Workout Bot API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if not settings.is_production else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.MINI_APP_URL, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST API routers
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(partnerships_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Webhook endpoint (Telegram → Aiogram)
# ---------------------------------------------------------------------------

@app.post("/webhook")
async def telegram_webhook(request: Request) -> Response:
    # Проверяем secret token от Telegram
    secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if secret != settings.WEBHOOK_SECRET:
        logger.warning("Secret token mismatch. Expected %r, got %r", settings.WEBHOOK_SECRET, secret)
        return Response(status_code=403)

    data = await request.json()
    update_id = data.get("update_id")
    logger.info("Processing Update ID: %s", update_id)
    update = Update.model_validate(data, context={"bot": bot})
    await dp.feed_update(bot=bot, update=update)
    return Response(status_code=200)

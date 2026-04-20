"""Прямые уведомления Telegram-ботом (в отличие от in-app notifications)."""
import logging

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError

logger = logging.getLogger(__name__)


async def send_bot_message(bot: Bot, telegram_id: int, text: str) -> None:
    """Fire-and-forget. Swallows все исключения (юзер мог удалить бота)."""
    try:
        await bot.send_message(chat_id=telegram_id, text=text)
    except (TelegramBadRequest, TelegramForbiddenError) as e:
        logger.info("send_bot_message skipped tg=%s: %s", telegram_id, e)
    except Exception as e:
        logger.warning("send_bot_message failed tg=%s: %s", telegram_id, e)

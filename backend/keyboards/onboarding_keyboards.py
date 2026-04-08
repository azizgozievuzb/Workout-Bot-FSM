"""Модуль для создания клавиатур процесса онбординга."""
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder


def get_language_keyboard() -> InlineKeyboardMarkup:
    """Возвращает клавиатуру для выбора языка."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="🇷🇺 Русский", callback_data="lang_ru"),
        InlineKeyboardButton(text="🇺🇿 O'zbekcha", callback_data="lang_uz"),
        InlineKeyboardButton(text="🇬🇧 English", callback_data="lang_en"),
    )
    return builder.as_markup()


def get_role_keyboard() -> InlineKeyboardMarkup:
    """Возвращает клавиатуру для выбора роли."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="Я — игрок", callback_data="role_player"),
        InlineKeyboardButton(text="Я — ответственный", callback_data="role_responsible"),
    )
    return builder.as_markup()


def get_gender_keyboard() -> InlineKeyboardMarkup:
    """Возвращает клавиатуру для выбора пола."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="Мужской", callback_data="gender_male"),
        InlineKeyboardButton(text="Женский", callback_data="gender_female"),
    )
    return builder.as_markup()

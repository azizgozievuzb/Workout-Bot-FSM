"""Клавиатуры для онбординга v2."""
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from aiogram.utils.keyboard import InlineKeyboardBuilder


def get_language_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="🇷🇺 Русский", callback_data="lang_ru"),
        InlineKeyboardButton(text="🇺🇿 O'zbek", callback_data="lang_uz"),
        InlineKeyboardButton(text="🇬🇧 English", callback_data="lang_en"),
    )
    return builder.as_markup()


def get_gender_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="Мужской", callback_data="gender_male"),
        InlineKeyboardButton(text="Женский", callback_data="gender_female"),
    )
    return builder.as_markup()


def get_survey_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="Почти не тренировался", callback_data="survey_1"))
    builder.row(InlineKeyboardButton(text="1-2 раза в неделю", callback_data="survey_2"))
    builder.row(InlineKeyboardButton(text="3+ раза в неделю", callback_data="survey_3"))
    return builder.as_markup()


def get_miniapp_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="🏋️ Открыть приложение",
            web_app=WebAppInfo(url="https://workout-bot-fsm.vercel.app"),
        )
    )
    return builder.as_markup()

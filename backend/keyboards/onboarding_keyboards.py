"""Клавиатуры для онбординга."""
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder


def get_language_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="🇷🇺 Русский", callback_data="lang_ru"),
        InlineKeyboardButton(text="🇺🇿 O'zbekcha", callback_data="lang_uz"),
        InlineKeyboardButton(text="🇬🇧 English", callback_data="lang_en"),
    )
    return builder.as_markup()


def get_role_keyboard(lang: str = "ru") -> InlineKeyboardMarkup:
    labels = {
        "ru": ("🏋️ Я — Игрок", "👁 Я — Ответственный"),
        "uz": ("🏋️ Men — O'yinchi", "👁 Men — Mas'ul"),
        "en": ("🏋️ I'm a Player", "👁 I'm Responsible"),
    }
    player_text, resp_text = labels.get(lang, labels["ru"])

    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text=player_text, callback_data="role_player"),
        InlineKeyboardButton(text=resp_text, callback_data="role_responsible"),
    )
    return builder.as_markup()


def get_gender_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="♂ Мужской", callback_data="gender_male"),
        InlineKeyboardButton(text="♀ Женский", callback_data="gender_female"),
    )
    return builder.as_markup()


def get_survey_keyboard() -> InlineKeyboardMarkup:
    """Опрос: частота тренировок. 3 варианта → разные стартовые окна."""
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="Почти не тренировался", callback_data="survey_1"))
    builder.row(InlineKeyboardButton(text="1-2 раза в неделю", callback_data="survey_2"))
    builder.row(InlineKeyboardButton(text="3+ раза в неделю", callback_data="survey_3"))
    return builder.as_markup()


def get_pairing_code_keyboard(code: str) -> InlineKeyboardMarkup:
    """Кнопка для копирования кода (через switch_inline_query)."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="📤 Поделиться кодом",
            switch_inline_query=f"Мой код для Workout Bot: {code}",
        )
    )
    return builder.as_markup()

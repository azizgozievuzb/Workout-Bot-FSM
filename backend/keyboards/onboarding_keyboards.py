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


def get_fitness_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="🟢 Новичок", callback_data="fitness_beginner"))
    builder.row(InlineKeyboardButton(text="🟡 Средний", callback_data="fitness_intermediate"))
    builder.row(InlineKeyboardButton(text="🔴 Продвинутый", callback_data="fitness_advanced"))
    return builder.as_markup()


def get_age_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="<18", callback_data="age_lt18"),
        InlineKeyboardButton(text="18-25", callback_data="age_18-25"),
    )
    builder.row(
        InlineKeyboardButton(text="26-35", callback_data="age_26-35"),
        InlineKeyboardButton(text="36-45", callback_data="age_36-45"),
    )
    builder.row(
        InlineKeyboardButton(text="46-55", callback_data="age_46-55"),
        InlineKeyboardButton(text="55+", callback_data="age_55plus"),
    )
    return builder.as_markup()


def get_goal_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="⚖️ Похудеть", callback_data="goal_lose_weight"))
    builder.row(InlineKeyboardButton(text="💪 Набрать массу", callback_data="goal_build_muscle"))
    builder.row(InlineKeyboardButton(text="🏃 Выносливость", callback_data="goal_endurance"))
    builder.row(InlineKeyboardButton(text="❤️ Здоровье", callback_data="goal_health"))
    builder.row(InlineKeyboardButton(text="🧘 Гибкость", callback_data="goal_flexibility"))
    return builder.as_markup()

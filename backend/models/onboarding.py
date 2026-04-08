"""
Pydantic-модель для контекста (состояния) FSM 'onboardingMachine'.

Обеспечивает 1:1 соответствие с TypeScript-типами в fsm_blueprints.
Используется для валидации и хранения данных в FSM-хранилище (Redis/Memory).
"""
from typing import Literal, Optional, Tuple

from pydantic import BaseModel, Field


class OnboardingContext(BaseModel):
    """
    Контекст данных для процесса онбординга пользователя.
    Строго соответствует 'context' из 101_onboardingMachine.ts.
    """
    lang: Optional[Literal['ru', 'uz', 'en']] = Field(
        default=None,
        description="Выбранный язык пользователя"
    )
    role: Optional[Literal['player', 'responsible']] = Field(
        default=None,
        description="Выбранная роль пользователя в системе"
    )
    gender: Optional[Literal['male', 'female']] = Field(
        default=None,
        description="Выбранный пол пользователя"
    )
    starting_window: Optional[Tuple[int, int, int]] = Field(
        default=None,
        alias="startingWindow",
        description="Результат опроса 'стартовое окно' для игрока"
    )
    pairing_code: Optional[str] = Field(
        default=None,
        alias="pairingCode",
        description="Код связывания, сгенерированный для игрока"
    )
    has_profile_photo: bool = Field(
        default=False,
        alias="hasProfilePhoto",
        description="Флаг, указывающий на наличие загруженного селфи"
    )

    class Config:
        """
        Конфигурация модели для совместимости с JS-неймингом (camelCase).
        Позволяет Pydantic корректно работать с данными из FSM-хранилища.
        """
        populate_by_name = True
        validate_assignment = True

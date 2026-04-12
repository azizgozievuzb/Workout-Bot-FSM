"""Pydantic-модели для пользователей (dual-role system)."""
from typing import Literal

from pydantic import BaseModel


class UserDualRole(BaseModel):
    """Поля dual-role системы из миграции 007."""
    primary_role: Literal["player", "responsible"] | None = None
    has_player_access: bool = False
    has_responsible_access: bool = False
    is_admin: bool = False


class PlayerStatsRest(BaseModel):
    """Поля отдыха из миграции 008."""
    rest_days_remaining: int = 3
    rest_days_used_this_month: int = 0

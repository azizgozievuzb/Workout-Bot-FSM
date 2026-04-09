"""Централизованная конфигурация. Всё из .env, никаких дефолтов для секретов."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Telegram
    BOT_TOKEN: str
    WEBHOOK_URL: str = ""     # https://your-domain.com (пустой до первого деплоя)
    WEBHOOK_SECRET: str = "dev_secret"
    MINI_APP_URL: str = "http://localhost:5173"

    # Supabase
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str  # service_role key (не anon!)

    # JWT
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24 * 30  # 30 дней

    # App
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"


settings = Settings()

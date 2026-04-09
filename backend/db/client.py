"""Supabase клиент — синглтон."""
from supabase import AsyncClient, acreate_client

from ..core.config import settings

_client: AsyncClient | None = None


async def get_supabase() -> AsyncClient:
    global _client
    if _client is None:
        _client = await acreate_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_KEY,
        )
    return _client

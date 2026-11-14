from ai_service.app.config import Settings
from ai_service.app.errors import ServiceUnavailableError
from ai_service.app.providers.base import LLMProvider
from ai_service.app.providers.groq import GroqProvider


def create_provider(settings: Settings) -> LLMProvider:
    if not settings.provider_is_configured:
        raise ServiceUnavailableError("The Groq provider is missing GROQ_API_KEY.")
    return GroqProvider(settings)

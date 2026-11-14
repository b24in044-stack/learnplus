from supabase import Client, ClientOptions, create_client
import httpx

from ai_service.app.config import Settings
from ai_service.app.errors import ServiceUnavailableError


def create_user_supabase_client(settings: Settings, access_token: str) -> Client:
    if not settings.supabase_is_configured:
        raise ServiceUnavailableError("AI service Supabase access is not configured.")
    if not isinstance(access_token, str) or not access_token.strip() or len(access_token) > 8192:
        raise ValueError("A valid Supabase access token is required.")

    return create_client(
        settings.supabase_url.strip(),
        settings.supabase_publishable_key.get_secret_value().strip(),
        options=ClientOptions(
            headers={"Authorization": f"Bearer {access_token.strip()}"},
            auto_refresh_token=False,
            persist_session=False,
        ),
    )


def create_admin_supabase_client(settings: Settings) -> Client:
    if not settings.supabase_is_configured:
        raise ServiceUnavailableError("AI service Supabase access is not configured.")
    if not settings.supabase_service_role_key:
        raise ServiceUnavailableError("AI service trusted profile lookup is not configured.")
    secret_key = settings.supabase_service_role_key.get_secret_value().strip()
    if not secret_key:
        raise ServiceUnavailableError("AI service trusted profile lookup is not configured.")

    return create_client(
        settings.supabase_url.strip(),
        secret_key,
        options=ClientOptions(
            auto_refresh_token=False,
            persist_session=False,
        ),
    )


def check_supabase_connectivity(settings: Settings) -> bool:
    if not settings.supabase_is_configured:
        return False

    api_key = settings.supabase_publishable_key.get_secret_value().strip()
    if settings.supabase_service_role_key:
        service_key = settings.supabase_service_role_key.get_secret_value().strip()
        if service_key:
            api_key = service_key

    response = httpx.get(
        f"{settings.supabase_url.rstrip('/')}/rest/v1/profiles",
        params={"select": "id", "limit": "1"},
        headers={"apikey": api_key, "Authorization": f"Bearer {api_key}"},
        timeout=5.0,
    )
    response.raise_for_status()
    return True

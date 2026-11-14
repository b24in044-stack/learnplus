from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from ai_service.app.config import Settings
from ai_service.app.errors import ServiceUnavailableError
from ai_service.app.supabase_client import check_supabase_connectivity, create_user_supabase_client


def test_default_groq_model_is_the_live_verified_model():
    settings = Settings(_env_file=None)

    assert settings.groq_model == "qwen/qwen3.8-27b"


def test_rag_chunk_limit_cannot_exceed_database_rpc_limit():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, rag_max_chunks=2001)


def test_supabase_requires_url_and_publishable_key():
    assert Settings(_env_file=None).supabase_is_configured is False
    assert Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
    ).supabase_is_configured is False
    assert Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="publishable-key",
    ).supabase_is_configured is True


def test_supabase_secret_key_is_accepted_as_server_key():
    settings = Settings(
        _env_file=None,
        SUPABASE_URL="https://project.supabase.co",
        SUPABASE_PUBLISHABLE_KEY="publishable-key",
        SUPABASE_SECRET_KEY="secret-key",
    )

    assert settings.supabase_service_role_key.get_secret_value() == "secret-key"


def test_user_supabase_client_uses_only_publishable_key_and_bearer_token(monkeypatch):
    observed = {}

    def fake_create_client(url, key, options):
        observed.update(url=url, key=key, options=options)
        return "client"

    monkeypatch.setattr("ai_service.app.supabase_client.create_client", fake_create_client)
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="publishable-key",
        supabase_service_role_key="server-secret",
    )

    assert create_user_supabase_client(settings, "user-access-token") == "client"
    assert observed["key"] == "publishable-key"
    assert observed["options"].headers["Authorization"] == "Bearer user-access-token"
    assert observed["options"].persist_session is False


def test_supabase_connectivity_uses_configured_server_key_for_database_probe(monkeypatch):
    observed = {}

    def fake_get(url, *, params, headers, timeout):
        observed.update(url=url, params=params, headers=headers, timeout=timeout)
        return SimpleNamespace(raise_for_status=lambda: None)

    monkeypatch.setattr("ai_service.app.supabase_client.httpx.get", fake_get)
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co/",
        supabase_publishable_key="publishable-key",
        supabase_service_role_key="server-secret",
    )

    assert check_supabase_connectivity(settings) is True
    assert observed["url"] == "https://project.supabase.co/rest/v1/profiles"
    assert observed["headers"]["apikey"] == "server-secret"
    assert observed["params"] == {"select": "id", "limit": "1"}


def test_user_supabase_client_rejects_missing_configuration_and_token():
    with pytest.raises(ServiceUnavailableError):
        create_user_supabase_client(Settings(_env_file=None), "access-token")
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="publishable-key",
    )
    with pytest.raises(ValueError):
        create_user_supabase_client(settings, " ")

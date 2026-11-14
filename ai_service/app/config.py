from functools import lru_cache

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    groq_api_key: SecretStr | None = None
    groq_model: str = "qwen/qwen3.8-27b"
    supabase_url: str | None = None
    supabase_publishable_key: SecretStr | None = None
    supabase_service_role_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    )
    ai_service_origins: str = (
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:3002,http://127.0.0.1:3002"
    )
    provider_timeout_seconds: float = Field(default=30.0, gt=0, le=120)
    max_input_characters: int = Field(default=6000, ge=500, le=20000)
    max_output_tokens: int = Field(default=900, ge=64, le=4096)
    max_history_messages: int = Field(default=20, ge=0, le=50)
    ai_requests_per_minute: int = Field(default=10, ge=1, le=120)
    embedding_enabled: bool = True
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = Field(default=384, ge=1, le=4096)
    rag_chunk_size: int = Field(default=600, ge=100, le=2000)
    rag_chunk_overlap: int = Field(default=100, ge=0, le=500)
    rag_max_document_bytes: int = Field(default=10 * 1024 * 1024, ge=1024, le=50 * 1024 * 1024)
    rag_max_extracted_characters: int = Field(default=2_000_000, ge=1000, le=10_000_000)
    rag_max_pages: int = Field(default=1000, ge=1, le=10000)
    rag_max_chunks: int = Field(default=2000, ge=1, le=2000)

    @field_validator("embedding_model")
    @classmethod
    def supported_embedding_model(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("EMBEDDING_MODEL must not be blank.")
        return normalized

    @field_validator("rag_chunk_overlap")
    @classmethod
    def valid_chunk_overlap(cls, value: int, info) -> int:
        chunk_size = info.data.get("rag_chunk_size", 600)
        if value >= chunk_size:
            raise ValueError("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE.")
        return value

    @property
    def provider_is_configured(self) -> bool:
        return bool(self.groq_api_key and self.groq_api_key.get_secret_value().strip())

    @property
    def supabase_is_configured(self) -> bool:
        return bool(
            self.supabase_url and self.supabase_url.strip()
            and self.supabase_publishable_key
            and self.supabase_publishable_key.get_secret_value().strip()
        )

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.ai_service_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

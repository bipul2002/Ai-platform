from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from pydantic import Field, model_validator
from urllib.parse import quote_plus
import re
from typing import Optional


class Settings(BaseSettings):
    """
    Settings class that pulls from environment variables first,
    then from .env.ai-runtime file, and falls back to defaults.
    """
    admin_backend_url: str = Field("http://localhost:4000", validation_alias="ADMIN_BACKEND_URL")
    openai_api_key: str = Field("", validation_alias="OPENAI_API_KEY")
    anthropic_api_key: str = Field("", validation_alias="ANTHROPIC_API_KEY")
    openrouter_api_key: str = Field("", validation_alias="OPENROUTER_API_KEY")
    embedding_model: str = Field("text-embedding-3-small", validation_alias="EMBEDDING_MODEL")
    llm_model: str = Field("gpt-4-turbo-preview", validation_alias="LLM_MODEL")
    
    # Database URLs
    pgvector_url: str = Field(
        "postgresql://postgres:postgres@postgres:5432/ai_query_platform", 
        validation_alias="PGVECTOR_URL"
    )
    system_db_url: Optional[str] = Field(None, validation_alias="SYSTEM_DB_URL")
    
    # Services
    redis_url: str = Field("redis://redis:6379", validation_alias="REDIS_URL")
    port: int = Field(8000, validation_alias="PORT")
    log_level: str = Field("INFO", validation_alias="LOG_LEVEL")
    internal_api_key: str = Field("internal-api-key", validation_alias="INTERNAL_API_KEY")
    
    # Auth
    jwt_secret: str = Field("secret", validation_alias="JWT_SECRET")
    jwt_algorithm: str = Field("HS256", validation_alias="JWT_ALGORITHM")
    encryption_key: str = Field(
        "32-byte-encryption-key-for-db-creds", 
        validation_alias="ENCRYPTION_KEY"
    )
    
    max_query_results: int = Field(1000, validation_alias="MAX_QUERY_RESULTS")
    query_timeout_seconds: int = Field(30, validation_alias="QUERY_TIMEOUT_SECONDS")
    embedding_dimension: int = Field(1536, validation_alias="EMBEDDING_DIMENSION")
    
    # Cache settings
    REDIS_ENABLED: bool = Field(True, validation_alias="REDIS_ENABLED")
    REDIS_URL: str = Field("redis://redis:6379", validation_alias="REDIS_URL")
    CACHE_TTL_SECONDS: int = Field(3600, validation_alias="CACHE_TTL_SECONDS")

    @model_validator(mode="after")
    def process_configs(self) -> 'Settings':
        # 1. Derive system_db_url from pgvector_url if not provided
        if not self.system_db_url:
            self.system_db_url = self.pgvector_url

        # 2. Force asyncpg driver for system_db_url (required for SQLAlchemy create_async_engine)
        if self.system_db_url.startswith("postgresql://"):
            self.system_db_url = self.system_db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        
        # 3. Ensure pgvector_url does NOT have +asyncpg (required for direct asyncpg.connect)
        if self.pgvector_url.startswith("postgresql+asyncpg://"):
            self.pgvector_url = self.pgvector_url.replace("postgresql+asyncpg://", "postgresql://", 1)

        # 4. Ensure both URLs have encoded passwords to handle special characters
        self.pgvector_url = self._encode_url_password(self.pgvector_url)
        self.system_db_url = self._encode_url_password(self.system_db_url)
        
        return self

    def _encode_url_password(self, url: str) -> str:
        """Encodes the password part of a database URL if it contains special characters."""
        if not url or "://" not in url or "@" not in url:
            return url
            
        try:
            scheme_parts = url.split("://", 1)
            scheme = scheme_parts[0]
            rest = scheme_parts[1]
            
            auth_host = rest.split("@", 1)
            auth = auth_host[0]
            host_path = auth_host[1]
            
            if ":" in auth:
                user, password = auth.split(":", 1)
                # Only encode if it contains characters that need encoding and isn't already encoded
                if any(c in password for c in "+=@/:?#[] %"):
                    # Basic check to avoid double encoding (don't encode if it has % followed by hex)
                    if not re.search(r'%[0-9a-fA-F]{2}', password):
                        encoded_password = quote_plus(password)
                        return f"{scheme}://{user}:{encoded_password}@{host_path}"
        except Exception:
            pass
        return url
    
    model_config = SettingsConfigDict(
        # Try different locations for the env file
        env_file=(".env", ".env.ai-runtime", "../.env.ai-runtime"),
        env_file_encoding="utf-8",
        extra="ignore"
    )


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

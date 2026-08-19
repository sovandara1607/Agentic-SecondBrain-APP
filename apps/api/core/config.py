from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    jwt_secret: str
    # Section 17's JWKS hardening: a JSON JWKS (EC public key + the
    # legacy HS256 key as an 'oct' entry), same value every other
    # self-hosted Supabase service (rest/storage/realtime/studio) already
    # receives as JWT_JWKS/API_JWT_JWKS/SUPABASE_JWKS. Empty by default -
    # core/auth.py falls back to the plain HS256 secret whenever this is
    # unset, so nothing changes here until a key rotation actually
    # populates it.
    jwt_jwks: str = ""
    # Browser origin allowed to call this API cross-origin (main.py's
    # CORSMiddleware). Defaults to the local web dev server; docker-compose
    # overrides it from NEXT_PUBLIC_SITE_URL so it tracks wherever web
    # actually runs.
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

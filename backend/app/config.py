from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    regulation_api_url: str = "http://109.202.1.153:8958"
    regulation_api_timeout: float = 15.0

    # When true — отдаём данные ТОЛЬКО из backend/data/fixtures/, upstream не дёргаем.
    # Когда false — пробуем upstream; при ошибке network/HTTP падаем на фикстуру (если она есть).
    use_fixtures: bool = True

    ragu_enabled: bool = False
    ragu_storage_folder: str = "./data/ragu_store"
    ragu_llm_model: str = "mistralai/mistral-medium-3"
    ragu_embed_model: str = "emb-qwen/qwen3-embedding-8b"
    openai_base_url: str = ""
    openai_api_key: str = ""

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    data_dir: str = "./data"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    regulation_api_url: str = "http://109.202.1.153:8958"
    regulation_api_timeout: float = 15.0

    # When true — отдаём данные ТОЛЬКО из backend/data/fixtures/, upstream не дёргаем.
    # Когда false — пробуем upstream; при ошибке network/HTTP падаем на фикстуру (если она есть).
    use_fixtures: bool = True

    # Когда true — на PUT /regulations/{id} помимо записи в DuckDB шлём Turtle в upstream `/data`.
    writeback_upstream: bool = False

    ragu_enabled: bool = False
    ragu_storage_folder: str = "./data/ragu_store"
    ragu_llm_model: str = "mistralai/mistral-medium-3"
    ragu_embed_model: str = "emb-qwen/qwen3-embedding-8b"
    openai_base_url: str = ""
    openai_api_key: str = ""

    # Какой LLM-провайдер за `openai_base_url`. От этого зависит:
    #  - можно ли проксировать Ollama-specific `extra_body.options` (num_ctx,
    #    num_predict) — Cerebras/Groq/OpenAI вернут 400 на неизвестное поле;
    #  - можно ли дёргать `/api/tags` и `/api/ps` (это native Ollama, не OpenAI);
    #  - какой fallback-список моделей показывать UI.
    llm_provider: Literal["ollama", "cerebras", "groq", "openrouter", "openai", "mock"] = "ollama"

    # Когда False — embeddings полностью отключены: и retrieval по корпусу
    # регламентов (embedding_index), и индексация загруженных PDF/DOCX
    # (document_store) уходят в keyword-only fallback. Для Railway-демо это
    # дефолт — Cerebras/Groq не дают free embeddings, и поднимать локальный
    # bge-m3 ради 8 seed-регламентов нерационально.
    embeddings_enabled: bool = False

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    data_dir: str = "./data"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

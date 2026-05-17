"""Тесты для llm_provider + embeddings_enabled переключений.

Проверяют:
  • /api/sandbox/llm-info отдаёт provider/embeddings_enabled/presets.
  • При llm_provider != ollama в chat-вызов НЕ передаются ollama-specific
    `extra_body.options` (иначе Cerebras/Groq отдают 400).
  • При embeddings_enabled=False document_store отказывается принимать PDF
    (503), а embedding_index.rebuild() возвращается с пустым _vectors.
  • При embeddings_enabled=False /api/sandbox/chat использует keyword-search
    (semantic_search), а не пытается дёрнуть embeddings.

LLM сам не зовём — мокаем AsyncOpenAI.chat.completions.create.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


# ── /api/sandbox/llm-info ──────────────────────────────────────────────


def test_llm_info_defaults_mock_provider(client):
    """Без OPENAI_BASE_URL — provider возвращается как настроено (ollama по
    дефолту), но mode=mock (нет реального endpoint'а). embeddings_enabled
    дефолт = False (для Railway-демо)."""
    r = client.get("/api/sandbox/llm-info")
    assert r.status_code == 200
    body = r.json()
    assert "provider" in body
    assert body["provider"] in ("ollama", "cerebras", "groq", "openrouter", "openai", "mock")
    assert "embeddings_enabled" in body
    assert body["embeddings_enabled"] is False
    # available_models должны быть из preset'а — для ollama не-пустой список.
    assert isinstance(body["available_models"], list)


def test_llm_info_cerebras_preset(monkeypatch, isolated_data_dir):
    """При llm_provider=cerebras возвращается соответствующий preset из
    _provider_model_presets. Конкретно — qwen-3-32b и llama-3.3-70b в списке."""
    monkeypatch.setenv("LLM_PROVIDER", "cerebras")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.cerebras.ai/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "csk-test-key")
    # Reload config чтобы новый env подхватился.
    import importlib
    from app import config as config_mod
    importlib.reload(config_mod)
    from app.main import app
    with TestClient(app) as c:
        r = c.get("/api/sandbox/llm-info")
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "cerebras"
    models = body["available_models"]
    assert any("qwen-3-32b" in m for m in models)
    assert any("llama-3.3-70b" in m for m in models)
    # Для cloud-провайдера llm_reachable считаем True по факту наличия api_key
    # (реальный ping не делаем — это первый запрос, не пингуем).
    assert body["llm_reachable"] is True


# ── extra_body не идёт в cloud-провайдеры ─────────────────────────────


@pytest.mark.asyncio
async def test_chat_strips_ollama_options_for_cerebras(monkeypatch, isolated_data_dir):
    """Когда провайдер не ollama, в `chat.completions.create()` НЕ должно
    проброситься поле extra_body — Cerebras/Groq отдадут 400 на неизвестный
    `options`."""
    monkeypatch.setenv("LLM_PROVIDER", "cerebras")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.cerebras.ai/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "csk-test-key")
    import importlib
    from app import config as config_mod
    importlib.reload(config_mod)
    from app.services import sandbox as sandbox_mod
    importlib.reload(sandbox_mod)
    # init store чтобы был хотя бы один регламент в retrieval.
    from app.services import regulation_store
    importlib.reload(regulation_store)
    regulation_store.init_db()

    captured_kwargs: dict = {}

    class FakeMessage:
        content = "ok"

    class FakeChoice:
        def __init__(self) -> None:
            self.message = FakeMessage()

    class FakeResponse:
        def __init__(self) -> None:
            self.choices = [FakeChoice()]

    class FakeCompletions:
        async def create(self, **kwargs):
            captured_kwargs.update(kwargs)
            return FakeResponse()

    class FakeChat:
        def __init__(self) -> None:
            self.completions = FakeCompletions()

    class FakeAsyncOpenAI:
        def __init__(self, **_kwargs) -> None:
            self.chat = FakeChat()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", FakeAsyncOpenAI)

    result = await sandbox_mod.chat(
        messages=[{"role": "user", "content": "какое давление?"}],
        num_ctx=8192,
        max_tokens=400,
    )
    assert result["mode"] == "real"
    # Главное: НЕТ extra_body в аргументах (Cerebras не понимает `options`).
    assert "extra_body" not in captured_kwargs, captured_kwargs
    # Стандартные OpenAI-поля передались.
    assert captured_kwargs.get("max_tokens") == 400
    assert captured_kwargs.get("temperature") is not None


@pytest.mark.asyncio
async def test_chat_keeps_ollama_options_for_ollama(monkeypatch, isolated_data_dir):
    """Для Ollama extra_body.options должны быть пробрасываются (num_ctx и
    num_predict — это её родной механизм управления генерацией)."""
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "ollama")
    import importlib
    from app import config as config_mod
    importlib.reload(config_mod)
    from app.services import sandbox as sandbox_mod
    importlib.reload(sandbox_mod)
    from app.services import regulation_store
    importlib.reload(regulation_store)
    regulation_store.init_db()

    captured_kwargs: dict = {}

    class FakeMessage:
        content = "ok"

    class FakeChoice:
        def __init__(self) -> None:
            self.message = FakeMessage()

    class FakeResponse:
        def __init__(self) -> None:
            self.choices = [FakeChoice()]

    class FakeCompletions:
        async def create(self, **kwargs):
            captured_kwargs.update(kwargs)
            return FakeResponse()

    class FakeChat:
        def __init__(self) -> None:
            self.completions = FakeCompletions()

    class FakeAsyncOpenAI:
        def __init__(self, **_kwargs) -> None:
            self.chat = FakeChat()

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", FakeAsyncOpenAI)

    await sandbox_mod.chat(
        messages=[{"role": "user", "content": "тест"}],
        num_ctx=4096,
        max_tokens=200,
    )
    assert "extra_body" in captured_kwargs
    opts = captured_kwargs["extra_body"]["options"]
    assert opts.get("num_ctx") == 4096
    assert opts.get("num_predict") == 200


# ── Embeddings выключены ──────────────────────────────────────────────


def test_upload_document_blocked_when_embeddings_disabled(client):
    """При embeddings_enabled=False загрузка PDF/DOCX отдаёт 503 — это явный
    сигнал пользователю, что фича недоступна на текущем провайдере."""
    # Минимальный fake-PDF: один байт мало, нужно валидное имя/mime. Не важно
    # что внутри — мы упрёмся в 503 ДО парсинга.
    files = {"file": ("dummy.pdf", b"%PDF-1.4 fake\n", "application/pdf")}
    r = client.post("/api/sandbox/documents/upload", files=files)
    assert r.status_code == 503
    assert "embed" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_embedding_index_rebuild_noop_when_disabled(isolated_data_dir):
    """rebuild() не должен делать сетевой вызов — просто фиксирует пустой
    индекс. is_fresh() после этого = True (signature совпадает с собой)."""
    import importlib
    from app import config as config_mod
    importlib.reload(config_mod)
    assert config_mod.settings.embeddings_enabled is False
    from app.services import regulation_store
    importlib.reload(regulation_store)
    regulation_store.init_db()
    from app.services import embedding_index
    importlib.reload(embedding_index)

    idx = embedding_index.get_index()
    await idx.rebuild()
    assert idx._vectors == {}
    assert idx.is_fresh() is True


@pytest.mark.asyncio
async def test_document_store_embed_returns_none_when_disabled(isolated_data_dir):
    """embed_chunks / embed_query — синхронно None, без HTTP-вызовов."""
    import importlib
    from app import config as config_mod
    importlib.reload(config_mod)
    from app.services import document_store
    importlib.reload(document_store)
    # Не должен дёрнуть AsyncOpenAI вообще.
    assert await document_store.embed_chunks(["хелло мир"]) is None
    assert await document_store.embed_query("любой запрос") is None

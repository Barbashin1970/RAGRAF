"""Общие фикстуры для всех бэкенд-тестов.

Главная задача: изолировать каждый тест от пользовательского `data/regulations.duckdb`,
чтобы прогон тестов не затирал реальные правки и не падал на DuckDB-локе из-за того,
что dev-сервер открыл тот же файл.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

# Принудительно подменяем data_dir и фикстуры ДО импорта приложения.
@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    """Каждый тест — свой data_dir; DuckDB лежит в tmp, не блокируется по dev-серверу."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("USE_FIXTURES", "true")
    monkeypatch.setenv("WRITEBACK_UPSTREAM", "false")
    # Принудительно mock-режим для воспроизводимости тестов: реальный RAGU
    # требует поднятой локальной Ollama, что неприемлемо в CI и не нужно
    # для проверки фичей не относящихся к LLM.
    monkeypatch.setenv("RAGU_ENABLED", "false")

    # сбрасываем кешированные модуль-уровень глобалы
    import importlib
    from app import config as config_mod
    importlib.reload(config_mod)
    from app.services import regulation_store
    importlib.reload(regulation_store)
    # sensor_schema_store держит свой singleton-_conn; без reload он
    # выживает между тестами и проносит данные одного теста в следующий.
    from app.services import sensor_schema_store
    importlib.reload(sensor_schema_store)
    # То же самое для extraction_term_store.
    from app.services import extraction_term_store
    importlib.reload(extraction_term_store)
    yield
    # cleanup: закрыть DuckDB connections обоих stores
    try:
        if regulation_store._conn is not None:
            regulation_store._conn.close()
            regulation_store._conn = None
    except Exception:
        pass
    try:
        if sensor_schema_store._conn is not None:
            sensor_schema_store._conn.close()
            sensor_schema_store._conn = None
    except Exception:
        pass
    try:
        from app.services import extraction_term_store as ets
        if ets._conn is not None:
            ets._conn.close()
            ets._conn = None
    except Exception:
        pass


@pytest.fixture
def store():
    """Готовый regulation_store с засеянными фикстурами."""
    from app.services import regulation_store as rs
    rs.init_db()
    return rs


@pytest.fixture
def sample_regulation():
    """Минимальный валидный Regulation для тестов сериализации/diff'а."""
    from app.schemas.domain import Parameter, Recommendation, Regulation

    return Regulation(
        id="test-reg",
        name="Тестовый регламент",
        domain="heating",
        date="2024-01-15",
        version="1.0",
        status="draft",
        parameters=[
            Parameter(
                id="pressure",
                name="pressure",
                datatype="decimal",
                referenceValue=20.5,
                deviationAllowed=1.5,
                unit="атм",
                minInclusive=0.0,
                maxInclusive=None,
            ),
            Parameter(
                id="diameter",
                name="diameter",
                datatype="decimal",
                referenceValue=5.0,
                deviationAllowed=0.2,
                unit="см",
                minInclusive=0.0,
                maxInclusive=None,
            ),
        ],
        constraints=[],
        recommendations=[
            Recommendation(
                id="rec1",
                text="Перекройте подачу, проверьте герметичность",
                priority=1,
                linkedParameters=["pressure", "diameter"],
            )
        ],
    )

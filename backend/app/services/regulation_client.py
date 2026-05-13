"""Async HTTP client for the upstream Regulation Management API.

Upstream API (FastAPI 0.1.0 at REGULATION_API_URL):

    GET/POST/PUT/DELETE /api/v1/regulations/{source_id}/data    — text/plain Turtle
    GET/POST/PUT/DELETE /api/v1/regulations/{source_id}/shapes  — text/plain Turtle
    GET                 /api/v1/regulations/admin/datasets/
    POST                /api/v1/regulations/admin/datasets/{app_id}

Поведение:
  * `USE_FIXTURES=true` — берём данные ТОЛЬКО из backend/data/fixtures/, upstream не дёргаем.
  * `USE_FIXTURES=false` — пробуем upstream; при network-ошибке / 4xx-5xx — если для
    данного source_id есть фикстура, отдаём её (как graceful fallback для дев-сессий).
"""
from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.services import fixtures


class RegulationClient:
    def __init__(self, base_url: str | None = None, timeout: float | None = None) -> None:
        self._base = (base_url or settings.regulation_api_url).rstrip("/")
        self._timeout = timeout or settings.regulation_api_timeout

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self._base, timeout=self._timeout)

    async def _try_upstream(self, fn):
        try:
            return await fn()
        except Exception:
            return None

    # ---- datasets ----

    async def list_datasets(self) -> list[dict[str, Any]] | dict[str, Any]:
        if settings.use_fixtures:
            return fixtures.list_fixtures()

        async def call():
            async with self._client() as c:
                r = await c.get("/api/v1/regulations/admin/datasets/")
                r.raise_for_status()
                data = r.json()
                return data if isinstance(data, (list, dict)) else []

        result = await self._try_upstream(call)
        if result is not None:
            return result
        return fixtures.list_fixtures()

    async def create_dataset(self, app_id: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.post(f"/api/v1/regulations/admin/datasets/{app_id}")
            r.raise_for_status()
            return r.json() if r.content else {}

    # ---- regulations (data, Turtle) ----

    async def get_data(self, source_id: str) -> str:
        if settings.use_fixtures and fixtures.has_fixture(source_id):
            return fixtures.read_data(source_id)

        async def call():
            async with self._client() as c:
                r = await c.get(f"/api/v1/regulations/{source_id}/data")
                r.raise_for_status()
                return r.text

        result = await self._try_upstream(call)
        if result is not None:
            return result
        if fixtures.has_fixture(source_id):
            return fixtures.read_data(source_id)
        return ""

    async def create_data(self, source_id: str, turtle: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.post(
                f"/api/v1/regulations/{source_id}/data",
                content=turtle,
                headers={"Content-Type": "text/plain"},
            )
            r.raise_for_status()
            return r.json() if r.content else {}

    async def update_data(self, source_id: str, turtle: str) -> None:
        async with self._client() as c:
            r = await c.put(
                f"/api/v1/regulations/{source_id}/data",
                content=turtle,
                headers={"Content-Type": "text/plain"},
            )
            r.raise_for_status()

    async def delete_data(self, source_id: str) -> None:
        async with self._client() as c:
            r = await c.delete(f"/api/v1/regulations/{source_id}/data")
            r.raise_for_status()

    # ---- shapes (SHACL, Turtle) ----

    async def get_shapes(self, source_id: str) -> str:
        if settings.use_fixtures and fixtures.has_fixture(source_id):
            return fixtures.read_shapes(source_id)

        async def call():
            async with self._client() as c:
                r = await c.get(f"/api/v1/regulations/{source_id}/shapes")
                r.raise_for_status()
                return r.text

        result = await self._try_upstream(call)
        if result is not None:
            return result
        if fixtures.has_fixture(source_id):
            return fixtures.read_shapes(source_id)
        return ""

    async def create_shapes(self, source_id: str, turtle: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.post(
                f"/api/v1/regulations/{source_id}/shapes",
                content=turtle,
                headers={"Content-Type": "text/plain"},
            )
            r.raise_for_status()
            return r.json() if r.content else {}

    async def update_shapes(self, source_id: str, turtle: str) -> None:
        async with self._client() as c:
            r = await c.put(
                f"/api/v1/regulations/{source_id}/shapes",
                content=turtle,
                headers={"Content-Type": "text/plain"},
            )
            r.raise_for_status()


client = RegulationClient()

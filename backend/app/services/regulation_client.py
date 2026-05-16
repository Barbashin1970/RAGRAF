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
from app.services import fixtures, regulation_store
from app.services.turtle_bridge import regulation_to_turtle


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
        # DuckDB store — authoritative источник для редактируемых регламентов.
        # Когда store сидится из фикстур (init_db), мы автоматически получаем
        # стартовый набор. Дальше редактирование идёт в store.
        try:
            store_items = regulation_store.list_all()
            if store_items:
                # Дополняем поле name из реестра фикстур если оно длиннее
                # (имена в REGISTRY — описательные, в Turtle часто короче).
                fx_index = {f["id"]: f for f in fixtures.list_fixtures()}
                for item in store_items:
                    fx = fx_index.get(item["id"])
                    if fx and len(str(fx.get("name", ""))) > len(str(item.get("name", ""))):
                        item["name"] = fx["name"]
                    if fx and "constraints_count" in fx:
                        item.setdefault("constraints_count", fx.get("constraints_count"))
                return store_items
        except Exception:
            pass  # fall through to upstream / fixtures

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
        # 1) DuckDB store — если регламент редактировался, отдаём свежую Turtle.
        try:
            reg = regulation_store.get(source_id)
            if reg is not None:
                return regulation_to_turtle(reg)
        except Exception:
            pass

        # 2) Локальная фикстура.
        if settings.use_fixtures and fixtures.has_fixture(source_id):
            return fixtures.read_data(source_id)

        # 3) Upstream.
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
        """Получить SHACL shapes для регламента.

        Приоритет:
          1. Фикстура (если `USE_FIXTURES=true` и у регламента есть shapes.ttl)
          2. Upstream Regulation API
          3. Фикстура без флага (fallback при недоступности upstream)
          4. **Derived shape** — генерируем `RegulationShape` из параметров
             регламента, лежащего в DuckDB store. Гарантирует что у каждого
             регламента есть форма валидации (ТЗ СИГМА §4.1.3 + Rules-Management.pdf
             пример), даже если аналитик не редактировал shapes явно. Это и есть
             то что СИГМА ждёт в bundle для валидации data.ttl.

        Возвращает пустую строку только если регламент полностью отсутствует
        (нет ни в фикстуре, ни в store).
        """
        if settings.use_fixtures and fixtures.has_fixture(source_id):
            shapes = fixtures.read_shapes(source_id)
            if shapes and shapes.strip():
                return shapes
            # Фикстура есть, но shapes.ttl пустой — продолжаем к derived fallback.

        async def call():
            async with self._client() as c:
                r = await c.get(f"/api/v1/regulations/{source_id}/shapes")
                r.raise_for_status()
                return r.text

        result = await self._try_upstream(call)
        if result is not None and result.strip():
            return result
        if fixtures.has_fixture(source_id):
            shapes = fixtures.read_shapes(source_id)
            if shapes and shapes.strip():
                return shapes

        # Derived fallback — генерируем RegulationShape из параметров.
        # Импортируем лениво чтобы избежать циклов на bootstrap.
        try:
            from app.services.turtle_bridge import regulation_to_shacl_shapes

            reg = regulation_store.get(source_id)
            if reg is not None:
                return regulation_to_shacl_shapes(reg)
        except Exception:
            pass
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

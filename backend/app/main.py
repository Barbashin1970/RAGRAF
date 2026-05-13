from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import datasets, flow, graph, regulations, shacl, search, validate, versions
from app.config import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(
    title="RAGRAF — Regulation Graph & Flow Editor",
    version="0.1.0",
    description="Визуализатор и редактор регламентов поверх Regulation Management API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


# All v1 endpoints are mounted under /api so the frontend uses /api/...
app.include_router(datasets.router, prefix="/api", tags=["datasets"])
app.include_router(regulations.router, prefix="/api", tags=["regulations"])
app.include_router(flow.router, prefix="/api", tags=["flow"])
app.include_router(validate.router, prefix="/api", tags=["flow"])
app.include_router(versions.router, prefix="/api", tags=["versions"])
app.include_router(shacl.router, prefix="/api", tags=["shacl"])
app.include_router(graph.router, prefix="/api", tags=["graph"])
app.include_router(search.router, prefix="/api", tags=["search"])

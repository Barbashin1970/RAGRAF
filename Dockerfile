# RAGRAF — monocontainer (Vite SPA + FastAPI в одном процессе uvicorn).
#
# Паттерн взят из POLINOM (multi-stage Node→Python), но упрощён:
# у нас фронт — Vite SPA, не Next.js, значит нет нужды в node-сервере
# и `start.sh` с координацией двух процессов. FastAPI раздаёт
# `frontend/dist/` через StaticFiles + catch-all на index.html.
#
# Контекст сборки = корень репозитория (см. railway.json и
# `.dockerignore` в корне).

###############################################################################
# Stage 1 — Vite build
###############################################################################
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Сначала lockfile для лучшего кэша слоёв (правки package.json реже,
# чем правки кода).
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Теперь код фронта + build. tsc -b + vite build (см. package.json:scripts).
COPY frontend/ ./
RUN npm run build

###############################################################################
# Stage 2 — Python runtime + статика
###############################################################################
FROM python:3.12-slim AS runtime

# System deps минимальные: curl для healthcheck (Railway пингует curl'ом
# из вне; локально полезно для отладки), ca-certificates для HTTPS-вызовов
# в Cerebras / Ollama-cloud. Никакого Node — FastAPI сам отдаёт SPA.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# Python deps — отдельным слоем для кэша.
COPY backend/requirements.txt /srv/backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /srv/backend/requirements.txt

# Backend код.
COPY backend/app /srv/backend/app

# Fixtures (data.ttl / shapes.ttl / flow.json) — СТАТИКА, путь хардкожен
# в коде через `Path(__file__).parents[2] / "data" / "fixtures"`
# (см. app/services/fixtures.py:3). Должны лежать РЯДОМ с backend/, не
# на Volume. Без них:
#   • flow.py GET /regulations/{id}/flow не находит стартер для регламентов
#     без runtime-флоу в /data/flows/ → React Flow рисует пустую диаграмму;
#   • turtle bridge не отдаёт shapes/data для seed-регламентов.
COPY backend/data/fixtures /srv/backend/data/fixtures

# Демо-документы для онбординга (ТЗ RAGRAF, ARC, ARC-SIGMA). Путь хардкожен в
# document_store.py через `Path(__file__).parents[2] / "data" / "demo_documents"`.
# При первом старте `seed_demo_documents_if_empty()` парсит их в DuckDB и
# выставляет enabled=True — новичок сразу видит «3/3 документов включено».
COPY backend/data/demo_documents /srv/backend/data/demo_documents

# Seed-данные DuckDB + начальное содержимое flows/ / versions/. ВАЖНО:
# это копируется в `_seed_data/`, а runtime-каталог `/data` будет Volume
# на Railway (см. start.sh — при первом запуске, если /data пустой,
# копируем сюда seed). Бэкап `regulations.duckdb.bak-*` в .dockerignore.
COPY backend/data /srv/_seed_data

# Vite-build из stage 1.
COPY --from=frontend-builder /app/dist /srv/frontend_dist

# Entry-point.
COPY start.sh /srv/start.sh
RUN chmod +x /srv/start.sh

# ── Runtime env ───────────────────────────────────────────────────────
# Указывает FastAPI где искать SPA-статику (см. main.py: static_dir).
ENV STATIC_DIR=/srv/frontend_dist
# Данные пишем в Volume — на Railway монтируется как /data.
ENV DATA_DIR=/data
# Stream Python logs для Railway logs view.
ENV PYTHONUNBUFFERED=1
# uvicorn слушает PORT который инжектит Railway; для self-host
# fallback 8080 в start.sh.
ENV PORT=8080

# Non-root user. Railway монтирует Volume как root, поэтому стартуем
# root'ом и в start.sh делаем chown + drop до ragraf через runuser
# (паттерн POLINOM start.sh §0).
RUN useradd -m -u 1000 ragraf \
    && mkdir -p /data \
    && chown -R ragraf:ragraf /srv /data

EXPOSE 8080

CMD ["/srv/start.sh"]

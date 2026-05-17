#!/usr/bin/env bash
# RAGRAF entrypoint — идемпотентный, безопасен на каждый редеплой.
#
# Назначение:
#   1. Privilege drop с поддержкой Railway Volume (root → ragraf через runuser).
#   2. Seed `/data` из встроенного `/srv/_seed_data` при ПЕРВОМ старте
#      (Volume на Railway монтируется пустым).
#   3. Запуск uvicorn на $PORT (FastAPI отдаёт API + SPA-статику).

set -euo pipefail

# 0) Privilege drop with Volume support.
#    Railway монтирует Volume как root:root → контейнер стартует root'ом,
#    чтобы chown'ить Volume на ragraf:1000, потом re-exec под non-root.
#    Паттерн POLINOM start.sh §0. Идемпотентно: повторный chown — no-op.
if [ "$(id -u)" -eq 0 ]; then
    DATA_DIR_PATH="${DATA_DIR:-/data}"
    if [ -d "$DATA_DIR_PATH" ]; then
        chown -R ragraf:ragraf "$DATA_DIR_PATH" 2>/dev/null \
            || echo "warn: chown $DATA_DIR_PATH failed — uvicorn будет писать с правами root"
    fi
    exec runuser -u ragraf -- "$0" "$@"
fi

DATA_DIR_PATH="${DATA_DIR:-/data}"
SEED_DIR="${SEED_DIR:-/srv/_seed_data}"
PORT="${PORT:-8080}"

echo "==> entrypoint:    /srv/start.sh"
echo "==> user:          $(id -un):$(id -gn) (uid=$(id -u))"
echo "==> python:        $(python --version 2>&1)"
echo "==> DATA_DIR:      ${DATA_DIR_PATH}"
echo "==> SEED_DIR:      ${SEED_DIR}"
echo "==> PORT:          ${PORT}"
echo "==> STATIC_DIR:    ${STATIC_DIR:-(not set)}"
echo "==> LLM_PROVIDER:  ${LLM_PROVIDER:-(not set)}"
echo "==> EMBEDDINGS:    ${EMBEDDINGS_ENABLED:-false}"

# 1) Seed Volume при первом запуске. Если в /data уже лежит DuckDB
#    (пользовательские правки), НИЧЕГО не трогаем — иначе можно
#    затереть продакшен-данные при ребилде. Маркером считаем сам
#    файл regulations.duckdb.
if [ ! -f "${DATA_DIR_PATH}/regulations.duckdb" ]; then
    if [ -d "$SEED_DIR" ]; then
        echo "==> /data пустой — копируем seed из ${SEED_DIR}"
        # cp -rn = не перезаписывать существующее (защита на случай частичной
        # инициализации). -L разворачивает симлинки, чтобы Volume не зависел
        # от структуры image. Бэкапы DuckDB в seed не попадают благодаря
        # .dockerignore, но на всякий случай отрежем тут тоже.
        mkdir -p "$DATA_DIR_PATH"
        find "$SEED_DIR" -mindepth 1 -maxdepth 1 \
            ! -name '*.bak-*' \
            -exec cp -rnL {} "$DATA_DIR_PATH"/ \;
        echo "==> seed copied:"
        ls -la "$DATA_DIR_PATH" | head -20
    else
        echo "==> WARN: seed dir ${SEED_DIR} отсутствует, DuckDB засеется через init_db()"
    fi
else
    echo "==> /data уже инициализирован — пропускаем seed"
fi

# 2) Запуск uvicorn. Workers=1 — DuckDB не любит multiprocess, у нас RLock
#    в stores. Bind 0.0.0.0:$PORT (Railway инжектит PORT). --no-access-log
#    чтобы не засорять Railway logs view; ошибки и stdout от приложения
#    остаются. Внутренние импорты делают `from app.config import ...`, поэтому
#    cwd должен быть `/srv/backend` (где лежит пакет `app/`) — иначе ImportError.
cd /srv/backend
exec python -m uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --no-access-log \
    --log-level info \
    --proxy-headers \
    --forwarded-allow-ips='*'

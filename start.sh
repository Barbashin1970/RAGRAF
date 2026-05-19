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

# 1) Pre-flight DuckDB integrity check.
#    Если файл DuckDB на Volume повреждён (несовместимая версия после
#    апгрейда библиотеки, abrupt-shutdown без флаша WAL, битый блок на
#    диске), при open() из uvicorn-процесса будет **сегфолт в native-коде
#    DuckDB** — Python не успеет его перехватить, контейнер крашится до
#    bind порта, healthcheck не проходит, деплой fail.
#
#    Защита: лёгкая Python-проба (open + SELECT 1). Если упало — ротируем
#    `regulations.duckdb` и `regulations.duckdb.wal` в `.broken-<ts>` для
#    возможной диагностики, дальше блок seed скопирует свежий файл.
#    Самовосстановление: при следующем деплое контейнер пройдёт probe и
#    станет в строй; пользовательские правки на сломанном файле теряются,
#    но **остаются доступны на Volume** под .broken-* для ручного REPAIR.
DUCKDB_FILE="${DATA_DIR_PATH}/regulations.duckdb"

# 0a) Опциональный hard-reset Volume по env-флагу.
#     SEED_FORCE_RESET=1 — ротирует существующий DuckDB в .obsolete-<ts>,
#     удаляет WAL и оставляет блок seed ниже подняться из чистых фикстур.
#     Использование: задать в Railway env, задеплоить ОДИН РАЗ, потом убрать
#     переменную. Цель — сбросить накопленный мусор тестовых датчиков/
#     триггеров на сайте, не теряя данные навсегда (.obsolete-* остаётся
#     на Volume и доступен для diagnostic dump).
if [ -f "$DUCKDB_FILE" ] && [ "${SEED_FORCE_RESET:-0}" = "1" ]; then
    TS=$(date +%s)
    echo "==> SEED_FORCE_RESET=1 — ротирую DuckDB в .obsolete-${TS} для re-seed"
    mv "${DUCKDB_FILE}" "${DUCKDB_FILE}.obsolete-${TS}" || true
    if [ -f "${DUCKDB_FILE}.wal" ]; then
        mv "${DUCKDB_FILE}.wal" "${DUCKDB_FILE}.wal.obsolete-${TS}" || true
    fi
fi

if [ -f "$DUCKDB_FILE" ]; then
    echo "==> DuckDB integrity check: ${DUCKDB_FILE}"
    # Probe — ТОЛЬКО read-only. Раньше делали write-roundtrip с UPDATE/COMMIT
    # на parameters чтобы поймать повреждённый PRIMARY KEY index. Это давало
    # **false-positive ротацию на каждый деплой** при transient COMMIT-ошибке
    # (например, версия DuckDB чуть-чуть отличается между dev и prod) →
    # файл ротировался в .broken-* → сид-блок копировал dev-snapshot
    # поверх прод-данных → **цифровые двойники пользователя терялись**.
    #
    # Новая логика:
    #   1) open + SELECT 1 — базовая читаемость.
    #   2) CHECKPOINT — force-flush WAL, лечит transient несоответствия.
    # БЕЗ write-probe. Если индексы повреждены при работе приложения, FastAPI
    # сам обработает ошибку и вернёт 500 на конкретный запрос — это лучше
    # чем тихо потерять данные. Crashes из-за SIGABRT в нативном DuckDB
    # ловятся первым же `SELECT 1` (нативный crash происходит на read
    # corrupted page, не на write).
    if python -c "
import duckdb, sys
try:
    c = duckdb.connect('${DUCKDB_FILE}')
    c.execute('SELECT 1').fetchone()
    try:
        c.execute('CHECKPOINT')
    except Exception as e:
        print(f'CHECKPOINT skipped: {type(e).__name__}: {e}', file=sys.stderr)
    c.close()
    sys.exit(0)
except Exception as e:
    print(f'duckdb probe failed: {type(e).__name__}: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1; then
        echo "==> DuckDB OK (read + checkpoint)"
    else
        EXIT_CODE=$?
        TS=$(date +%s)
        echo "==> WARN: DuckDB-файл повреждён (exit ${EXIT_CODE} — SIGABRT=134/SIGSEGV=139/Python=1) — ротируем в .broken-${TS}"
        mv "${DUCKDB_FILE}" "${DUCKDB_FILE}.broken-${TS}" 2>/dev/null || true
        if [ -f "${DUCKDB_FILE}.wal" ]; then
            mv "${DUCKDB_FILE}.wal" "${DUCKDB_FILE}.wal.broken-${TS}" 2>/dev/null || true
        fi
        echo "==> ротация выполнена; init_db() сейчас создаст свежий файл из фикстур"
    fi
fi

# 2) Seed Volume при первом запуске или после ротации повреждённого файла.
#    Если в /data уже лежит валидный DuckDB (probe выше прошёл), НИЧЕГО
#    не трогаем. Маркером считаем сам файл regulations.duckdb.
if [ ! -f "${DATA_DIR_PATH}/regulations.duckdb" ]; then
    if [ -d "$SEED_DIR" ]; then
        echo "==> /data пустой — копируем seed из ${SEED_DIR}"
        # cp -rn = не перезаписывать существующее (защита на случай частичной
        # инициализации). -L разворачивает симлинки, чтобы Volume не зависел
        # от структуры image.
        #
        # ВАЖНО: ЯВНО исключаем `regulations.duckdb*` (хотя они уже отрезаны
        # .dockerignore'ом) — defense-in-depth от регрессии. БД на проде
        # ВСЕГДА должна создаваться через `init_db()` из фикстур, никогда
        # не копироваться dev-snapshot'ом. Иначе цифровые двойники
        # пользователя теряются. Аналогично `flows/` и `versions/` — это
        # user-state, копировать его из dev-машины нельзя.
        mkdir -p "$DATA_DIR_PATH"
        find "$SEED_DIR" -mindepth 1 -maxdepth 1 \
            ! -name 'regulations.duckdb' \
            ! -name 'regulations.duckdb.wal' \
            ! -name 'flows' \
            ! -name 'versions' \
            ! -name 'ragu_store' \
            ! -name 'source_documents' \
            ! -name '*.bak-*' \
            ! -name '*.broken-*' \
            ! -name '*.obsolete-*' \
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

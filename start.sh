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
    # Двухстадийный probe + двухстадийное recovery, чтобы при corruption WAL
    # сохранить главный DB-файл и не терять закоммиченные данные пользователя.
    #
    # Раньше при ЛЮБОЙ ошибке открытия мы ротировали main + WAL вместе,
    # потом init_db() пересоздавал БД из фикстур — **все twins / правки /
    # audit пользователя терялись**. На Railway это видно из лога:
    #   Failure while replaying WAL file ... GetDefaultDatabase
    # — это типичный сценарий «контейнер убит SIGKILL в момент ALTER TABLE,
    # WAL содержит partial-entry, при replay падает». Главный .duckdb при
    # этом валиден; corrupted только WAL.
    #
    # Стратегия:
    #   1. open + SELECT 1 + CHECKPOINT — если ок, ничего не делаем.
    #   2. Если ошибка И есть WAL — ротируем ТОЛЬКО WAL, retry open.
    #   3. Если retry прошёл — данные сохранены (минус незакоммиченные
    #      транзакции, которые лежали в WAL).
    #   4. Если retry тоже упал — главный файл реально битый, ротируем его
    #      (последнее средство, данные теряются).
    probe_db() {
        python -c "
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
" 2>&1
    }

    if probe_db; then
        echo "==> DuckDB OK (read + checkpoint)"
    else
        TS=$(date +%s)
        if [ -f "${DUCKDB_FILE}.wal" ]; then
            echo "==> WARN: open упал, есть WAL — пробуем стратегию «WAL-only recovery»"
            echo "==> WAL → ${DUCKDB_FILE}.wal.broken-${TS} (главный файл оставляем)"
            mv "${DUCKDB_FILE}.wal" "${DUCKDB_FILE}.wal.broken-${TS}" 2>/dev/null || true
            if probe_db; then
                echo "==> ✓ Главный DB-файл валиден — данные пользователя сохранены"
                echo "==> (потеряны только незакоммиченные транзакции из удалённого WAL)"
            else
                echo "==> ✗ Главный DB-файл тоже повреждён — ротируем в .broken-${TS}"
                mv "${DUCKDB_FILE}" "${DUCKDB_FILE}.broken-${TS}" 2>/dev/null || true
                echo "==> init_db() пересоздаст БД из фикстур (twins/правки пользователя потеряны)"
            fi
        else
            echo "==> WARN: open упал, WAL отсутствует — главный файл повреждён"
            mv "${DUCKDB_FILE}" "${DUCKDB_FILE}.broken-${TS}" 2>/dev/null || true
            echo "==> init_db() пересоздаст БД из фикстур (twins/правки пользователя потеряны)"
        fi
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

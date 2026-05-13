#!/bin/bash
# E2E смоук — поднимает изолированный backend на свободном порту, прогоняет
# полный цикл (список → правка → diff → publish → archive → restore → cleanup),
# валит при первом fail. Не трогает dev DuckDB и не зависит от запущенного UI.
#
# Назначение: «один скрипт, чтобы убедиться что ничего не сломалось» — запускать
# после крупных рефакторингов, перед merge, в CI.
#
# Usage: ./scripts/e2e-smoke.sh [--keep-server]
#   --keep-server   не глушить backend после теста (для ручной отладки)

set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8888}
DATA_DIR=$(mktemp -d /tmp/ragraf-e2e-XXXXXX)
LOG_FILE="$DATA_DIR/server.log"
KEEP=0
for a in "$@"; do
  [ "$a" = "--keep-server" ] && KEEP=1
done

# ── ANSI цвета ────────────────────────────────────────────────────────────
C_OK='\033[0;32m'; C_ERR='\033[0;31m'; C_INFO='\033[0;33m'; C_RESET='\033[0m'
ok()   { printf "${C_OK}✓ %s${C_RESET}\n" "$*"; }
info() { printf "${C_INFO}▶ %s${C_RESET}\n" "$*"; }
fail() { printf "${C_ERR}✗ %s${C_RESET}\n" "$*" >&2; exit 1; }

# ── 1. Стартуем изолированный backend ─────────────────────────────────────
info "Тестовая папка: $DATA_DIR"

# Если порт занят (зомби от предыдущего fail'нувшегося прогона) — гасим жёстко.
existing=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
if [ -n "$existing" ]; then
  info "Порт $PORT занят (pid $existing) — гашу"
  echo "$existing" | xargs kill -9 2>/dev/null || true
  sleep 0.5
fi

info "Стартую backend на :$PORT с DATA_DIR=$DATA_DIR"
(
  cd backend
  DATA_DIR="$DATA_DIR" USE_FIXTURES=true WRITEBACK_UPSTREAM=false \
    exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --log-level warning
) > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

cleanup() {
  if [ "$KEEP" -eq 0 ]; then
    # Гасим именно нашего ребёнка и любого uvicorn-а на нашем порту
    # (на случай если subshell не пробросил signal).
    [ -n "${SERVER_PID:-}" ] && kill -9 "$SERVER_PID" 2>/dev/null || true
    lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
    rm -rf "$DATA_DIR"
  fi
}
trap cleanup EXIT

# Дожидаемся health
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    ok "Backend готов"
    break
  fi
  sleep 0.3
  [ "$i" = 30 ] && { tail -n 30 "$LOG_FILE"; fail "Backend не отвечает за 9 секунд"; }
done

# ── helpers ──────────────────────────────────────────────────────────────
API="http://127.0.0.1:$PORT/api"

# assert HTTP code
http_get() {
  local code
  code=$(curl -fsS -o /tmp/ragraf-e2e-body -w "%{http_code}" "$1") || true
  [ "$code" = "$2" ] || fail "$1 → $code (ждали $2). Body: $(cat /tmp/ragraf-e2e-body)"
}

# JSON-проба через jq если есть, иначе python
jget() {
  python3 -c "import sys,json; d=json.load(open('/tmp/ragraf-e2e-body')); print($1)"
}

# ── 2. Проверка базовых endpoints ─────────────────────────────────────────
http_get "$API/domains" 200
COUNT=$(jget "len(d)")
[ "$COUNT" -ge 4 ] || fail "domains: ждали ≥4, получили $COUNT"
ok "/api/domains: $COUNT доменов"

http_get "$API/datasets" 200
REG_COUNT=$(jget "len(d)")
[ "$REG_COUNT" = 6 ] || fail "datasets: ждали 6 регламентов после seed, получили $REG_COUNT"
ok "/api/datasets: $REG_COUNT регламентов засеяны из фикстур"

http_get "$API/regulations/pressure-diameter" 200
PRESSURE=$(jget "[p for p in d['parameters'] if p['name']=='pressure'][0]['referenceValue']")
[ "$PRESSURE" = "20.5" ] || fail "pressure-diameter pressure.ref: ждали 20.5, получили $PRESSURE"
ok "/api/regulations/pressure-diameter: pressure.ref=20.5 (соответствует Rules-Management.pdf)"

# ── 3. Редактирование регламента ──────────────────────────────────────────
info "PUT — меняем pressure → 25.0, добавляем новый параметр flow"
curl -fsS -X PUT -H "Content-Type: application/json" "$API/regulations/pressure-diameter" -d '{
  "id": "pressure-diameter",
  "name": "Регламент на параметры давления и диаметра (E2E SMOKE)",
  "domain": "heating",
  "date": "2024-01-15",
  "version": "1.0",
  "status": "draft",
  "parameters": [
    {"id":"pressure","name":"pressure","datatype":"decimal","referenceValue":25.0,"deviationAllowed":1.5,"unit":"атм","minInclusive":0.0,"maxInclusive":null},
    {"id":"diameter","name":"diameter","datatype":"decimal","referenceValue":5.0,"deviationAllowed":0.2,"unit":"см","minInclusive":0.0,"maxInclusive":null},
    {"id":"flow","name":"flow","datatype":"decimal","referenceValue":1.5,"deviationAllowed":0.3,"unit":"м³/ч","minInclusive":0.0,"maxInclusive":null}
  ],
  "constraints": [],
  "recommendations":[{"id":"rec1","text":"E2E SMOKE recommendation","priority":1,"linkedParameters":["pressure","diameter","flow"]}]
}' >/tmp/ragraf-e2e-body
VERSION_AFTER_EDIT=$(jget "d['version']")
ok "PUT успешно, версия: $VERSION_AFTER_EDIT"

http_get "$API/regulations/pressure-diameter" 200
NEW_PRESSURE=$(jget "[p for p in d['parameters'] if p['name']=='pressure'][0]['referenceValue']")
NEW_PARAM_COUNT=$(jget "len(d['parameters'])")
[ "$NEW_PRESSURE" = "25.0" ] || fail "После reload: pressure.ref ждали 25.0, получили $NEW_PRESSURE"
[ "$NEW_PARAM_COUNT" = 3 ] || fail "После reload: ждали 3 параметра, получили $NEW_PARAM_COUNT"
ok "Reload: pressure=25.0, параметров стало 3 (+flow)"

# ── 4. История + diff ─────────────────────────────────────────────────────
http_get "$API/regulations/pressure-diameter/regulation-history" 200
HIST_LEN=$(jget "len(d)")
[ "$HIST_LEN" -ge 2 ] || fail "history: ждали ≥2 версий (seed + edit), получили $HIST_LEN"
LATEST_DIFF=$(jget "d[0]['diff_summary']")
LATEST_VID=$(jget "d[0]['version_id']")
ok "history: $HIST_LEN версий, latest diff_summary: $LATEST_DIFF"

http_get "$API/regulations/pressure-diameter/regulation-diff/$LATEST_VID" 200
DIFF_CHANGE_COUNT=$(jget "len(d['changes'])")
[ "$DIFF_CHANGE_COUNT" -ge 1 ] || fail "diff: ждали ≥1 change, получили $DIFF_CHANGE_COUNT"
ok "regulation-diff: $DIFF_CHANGE_COUNT structured changes"

# ── 5. Approval workflow ──────────────────────────────────────────────────
curl -fsS -X POST "$API/regulations/pressure-diameter/publish" >/tmp/ragraf-e2e-body
STATUS=$(jget "d['status']")
[ "$STATUS" = "active" ] || fail "publish: ждали status=active, получили $STATUS"
ok "POST /publish → status=active"

curl -fsS -X POST "$API/regulations/pressure-diameter/archive" >/tmp/ragraf-e2e-body
STATUS=$(jget "d['status']")
[ "$STATUS" = "archived" ] || fail "archive: ждали status=archived, получили $STATUS"
ok "POST /archive → status=archived"

# ── 6. Restore ────────────────────────────────────────────────────────────
http_get "$API/regulations/pressure-diameter/regulation-history" 200
# Самая старая версия (хвост списка) — это seed; комментарий на русском "Сидинг…",
# поэтому надёжнее брать по позиции, а не по подстроке.
SEED_VID=$(jget "d[-1]['version_id']")
curl -fsS -X POST "$API/regulations/pressure-diameter/regulation-restore/$SEED_VID" >/tmp/ragraf-e2e-body
RESTORED_PRESSURE=$(jget "[p for p in d['parameters'] if p['name']=='pressure'][0]['referenceValue']")
[ "$RESTORED_PRESSURE" = "20.5" ] || fail "restore: ждали pressure=20.5, получили $RESTORED_PRESSURE"
ok "POST /regulation-restore вернул к seed (pressure=20.5)"

# ── 7. Constraints + Turtle ───────────────────────────────────────────────
http_get "$API/regulations/pressure-diameter/constraints" 200
CONSTR_COUNT=$(jget "len(d)")
[ "$CONSTR_COUNT" -ge 6 ] || fail "constraints: ждали ≥6, получили $CONSTR_COUNT"
ok "constraints: $CONSTR_COUNT ограничений (из SHACL shapes)"

http_get "$API/regulations/pressure-diameter/raw" 200
grep -q ":PressureDiameterRegulation a :Regulation" /tmp/ragraf-e2e-body \
  || fail "raw: Turtle не содержит ожидаемого инстанса :PressureDiameterRegulation"
ok "raw: Turtle writeback корректный (Regulation instance найден)"

# ── 8. Flow editor endpoints ──────────────────────────────────────────────
http_get "$API/regulations/pressure-diameter/flow" 200
FLOW_NODES=$(jget "len(d['nodes'])")
[ "$FLOW_NODES" -ge 1 ] || fail "flow: ждали ≥1 узел (стартер из фикстуры), получили $FLOW_NODES"
ok "flow: $FLOW_NODES узлов в стартовом DSL"

# ── 9. Graph view с domain filter ─────────────────────────────────────────
http_get "$API/graph?domain=heating" 200
NODES_HEATING=$(jget "d['meta']['total_nodes']")
http_get "$API/graph?domain=housing" 200
NODES_HOUSING=$(jget "d['meta']['total_nodes']")
[ "$NODES_HEATING" -gt 0 ] && [ "$NODES_HOUSING" -gt 0 ] \
  || fail "graph: пустые ответы для heating ($NODES_HEATING) или housing ($NODES_HOUSING)"
ok "graph?domain=heating: $NODES_HEATING узлов, ?domain=housing: $NODES_HOUSING — разведены"

# ── Done ──────────────────────────────────────────────────────────────────
echo
ok "Все E2E проверки пройдены ✨"
[ "$KEEP" -eq 1 ] && info "Backend оставлен на :$PORT (PID $SERVER_PID), DATA_DIR=$DATA_DIR"

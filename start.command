#!/bin/bash
# RAGRAF — локальный запуск (macOS / Linux).
# Двойной клик по этому файлу в Finder или ./start.command в терминале.
#
# Флаги:
#   --no-open       не открывать браузер
#   --backend-only  поднять только бэкенд
#   --frontend-only поднять только фронт (бэкенд не нужен — будут 502)
#   --reset-deps    переустановить venv и node_modules
#   --port-back N   порт бэкенда (default 8000)
#   --port-front N  порт фронта   (default 5173)

set -e
cd "$(dirname "$0")"

PROJECT_ROOT="$(pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
VENV_DIR="$BACKEND_DIR/.venv"
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

OPT_OPEN=1
OPT_BACK=1
OPT_FRONT=1
OPT_RESET=0
PORT_BACK=8000
PORT_FRONT=5173
for arg in "$@"; do
  case "$arg" in
    --no-open)        OPT_OPEN=0 ;;
    --backend-only)   OPT_FRONT=0 ;;
    --frontend-only)  OPT_BACK=0  ;;
    --reset-deps)     OPT_RESET=1 ;;
    --port-back=*)    PORT_BACK="${arg#--port-back=}" ;;
    --port-front=*)   PORT_FRONT="${arg#--port-front=}" ;;
    -h|--help)
      sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Неизвестный флаг: $arg"; exit 1 ;;
  esac
done

# --- ANSI цвета ---
C_BACK='\033[0;36m'
C_FRONT='\033[0;35m'
C_INFO='\033[0;33m'
C_OK='\033[0;32m'
C_ERR='\033[0;31m'
C_RESET='\033[0m'

info()    { printf "${C_INFO}▶ %s${C_RESET}\n" "$*"; }
success() { printf "${C_OK}✓ %s${C_RESET}\n" "$*"; }
fail()    { printf "${C_ERR}✗ %s${C_RESET}\n" "$*" >&2; }

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Не найдено: $1. Установи и перезапусти."
    exit 1
  fi
}

# --- Cleanup on exit ---
BACK_PID=""
FRONT_PID=""
CLEANUP_DONE=0
cleanup() {
  # Идемпотентность: ловим INT/TERM/HUP/EXIT, но cleanup отрабатывает ровно
  # один раз. Без этого при Ctrl+C сначала срабатывает INT (cleanup), а потом
  # EXIT (cleanup ещё раз) — двойной "Готово" в выводе.
  if [ "$CLEANUP_DONE" -eq 1 ]; then return; fi
  CLEANUP_DONE=1
  # Снимаем trap'ы, чтобы повторные сигналы во время cleanup не запутали.
  trap - INT TERM HUP EXIT

  echo
  info "Останавливаю процессы…"
  # Сначала прибиваем поддеревья (uvicorn --reload спавнит worker'а;
  # vite/npm — esbuild и сопутствующие). Без pkill -P они часто отвязываются
  # от родителя и переживают сам скрипт → следующий запуск падает с Errno 48.
  for pid in "$BACK_PID" "$FRONT_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    fi
  done
  pkill -P $$ 2>/dev/null || true
  # Грейс на graceful-shutdown
  sleep 0.5
  # Контрольный SIGKILL по нашим портам: если worker всё-таки отвязался —
  # без этого он переживёт скрипт и сломает следующий запуск.
  local leftovers
  leftovers=$(lsof -ti tcp:"$PORT_BACK" -i tcp:"$PORT_FRONT" 2>/dev/null || true)
  if [ -n "$leftovers" ]; then
    kill -9 $leftovers 2>/dev/null || true
  fi
  success "Готово. Лог-файлы остались в logs/"
  # Без exit bash возвращается в interrupted-команду и продолжает loop'иться.
  # Trap «handles» сигнал, но не завершает скрипт — нужен явный exit.
  exit 0
}
# Покрываем все способы выхода:
#   INT  — Ctrl+C
#   TERM — kill PID, Activity Monitor "Quit"
#   HUP  — закрытие Terminal.app окна без Ctrl+C (macOS шлёт SIGHUP)
#   EXIT — любой выход из скрипта (включая ошибки set -e и естественный финал)
trap cleanup INT TERM HUP EXIT

# --- Setup backend ---
if [ "$OPT_BACK" -eq 1 ]; then
  need python3
  if [ "$OPT_RESET" -eq 1 ] && [ -d "$VENV_DIR" ]; then
    info "Удаляю старый venv…"
    rm -rf "$VENV_DIR"
  fi
  if [ ! -d "$VENV_DIR" ]; then
    info "Создаю venv для бэкенда…"
    python3 -m venv "$VENV_DIR"
    "$VENV_DIR/bin/pip" install -q --upgrade pip
  fi
  # Ставим зависимости, если каких-то нет
  if ! "$VENV_DIR/bin/python" -c "import fastapi, uvicorn, rdflib, pyshacl, httpx, networkx" 2>/dev/null; then
    info "Устанавливаю зависимости backend (requirements.txt)…"
    "$VENV_DIR/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
    success "Зависимости backend готовы"
  fi
  # .env если его ещё нет
  if [ ! -f "$BACKEND_DIR/.env" ] && [ -f "$BACKEND_DIR/.env.example" ]; then
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
    info "Создан $BACKEND_DIR/.env из .env.example"
  fi
fi

# --- Setup frontend ---
if [ "$OPT_FRONT" -eq 1 ]; then
  need node
  need npm
  if [ "$OPT_RESET" -eq 1 ] && [ -d "$FRONTEND_DIR/node_modules" ]; then
    info "Удаляю node_modules…"
    rm -rf "$FRONTEND_DIR/node_modules"
  fi
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "Устанавливаю зависимости frontend (npm install)…"
    (cd "$FRONTEND_DIR" && npm install --no-audit --no-fund --loglevel=error)
    success "Зависимости frontend готовы"
  fi
fi

# --- Self-healing: подчищаем недозакрытые сессии прошлого запуска ---
#
# Типовая поломка: пользователь закрыл терминал без Ctrl+C, uvicorn --reload
# оставил пару (reloader + worker), один из них пережил, держит порт. Новый
# uvicorn получает Errno 48 и падает, но curl /health отвечает ЗОМБИ, и
# launcher ошибочно докладывает «Backend готов». Решение — гарантированно
# освобождаем порт по эскалации: SIGTERM → wait → SIGKILL → проверка → fail.
ensure_port_free() {
  local p=$1
  local name=$2
  for attempt in 1 2 3; do
    local pids
    pids=$(lsof -ti tcp:"$p" 2>/dev/null || true)
    if [ -z "$pids" ]; then
      return 0
    fi
    case "$attempt" in
      1)
        # Сразу даём контекст: пользователь видит почему мы что-то трогаем.
        info "Порт $p ($name) занят прошлой сессией — освобождаю (pids: $(echo $pids))…"
        # SIGTERM всему дереву каждого pid (uvicorn-reloader спавнит worker'а).
        for q in $pids; do pkill -P "$q" 2>/dev/null || true; done
        kill $pids 2>/dev/null || true
        sleep 1
        ;;
      2)
        info "Не отпустили по SIGTERM — применяю SIGKILL…"
        for q in $pids; do pkill -9 -P "$q" 2>/dev/null || true; done
        kill -9 $pids 2>/dev/null || true
        sleep 1
        ;;
      3)
        fail "Порт $p всё ещё занят: $(echo $pids)."
        fail "  Возможно, это не наш процесс (другой пользователь / другой сервис)."
        fail "  Останови вручную: kill -9 $(echo $pids)"
        fail "  Или запусти RAGRAF на другом порту: ./start.command --port-back=8001"
        return 1
        ;;
    esac
  done
  return 1
}

if [ "$OPT_BACK" -eq 1 ]; then
  ensure_port_free "$PORT_BACK" "backend" || exit 1
fi
if [ "$OPT_FRONT" -eq 1 ]; then
  ensure_port_free "$PORT_FRONT" "frontend" || exit 1
fi

# Подчистим возможные DuckDB-лок-файлы от ungraceful-shutdown'а.
# DuckDB сам делает WAL-recovery при следующем открытии; .tmp-файлы безопасно
# удалять (это staging для writes). Не трогаем .duckdb сам и .wal — они нужны.
find "$BACKEND_DIR/data" -maxdepth 2 -name "*.duckdb.tmp" -mtime +0 -delete 2>/dev/null || true

# --- Start backend ---
BACK_LOG="$LOG_DIR/backend.log"
if [ "$OPT_BACK" -eq 1 ]; then
  info "Стартую backend на http://localhost:$PORT_BACK …"
  (
    cd "$BACKEND_DIR"
    exec "$VENV_DIR/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$PORT_BACK" --reload
  ) > "$BACK_LOG" 2>&1 &
  BACK_PID=$!
  # подождём до health
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT_BACK/health" >/dev/null 2>&1; then
      success "Backend готов (PID $BACK_PID, log: logs/backend.log)"
      break
    fi
    sleep 0.5
    if ! kill -0 "$BACK_PID" 2>/dev/null; then
      fail "Backend упал на старте. Последние строки:"
      tail -n 30 "$BACK_LOG" || true
      exit 1
    fi
    [ "$i" = 30 ] && fail "Backend не отвечает за 15 секунд."
  done
fi

# --- Start frontend ---
FRONT_LOG="$LOG_DIR/frontend.log"
if [ "$OPT_FRONT" -eq 1 ]; then
  info "Стартую frontend на http://localhost:$PORT_FRONT …"
  (
    cd "$FRONTEND_DIR"
    export VITE_API_PROXY="http://127.0.0.1:$PORT_BACK"
    export VITE_PORT="$PORT_FRONT"
    exec npm run dev -- --host 127.0.0.1 --port "$PORT_FRONT"
  ) > "$FRONT_LOG" 2>&1 &
  FRONT_PID=$!
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$PORT_FRONT" >/dev/null 2>&1; then
      success "Frontend готов (PID $FRONT_PID, log: logs/frontend.log)"
      break
    fi
    sleep 0.5
    if ! kill -0 "$FRONT_PID" 2>/dev/null; then
      fail "Frontend упал на старте. Последние строки:"
      tail -n 30 "$FRONT_LOG" || true
      [ -n "$BACK_PID" ] && kill "$BACK_PID" 2>/dev/null
      exit 1
    fi
    [ "$i" = 60 ] && fail "Frontend не отвечает за 30 секунд."
  done
fi

# --- Open browser ---
if [ "$OPT_OPEN" -eq 1 ] && [ "$OPT_FRONT" -eq 1 ]; then
  URL="http://localhost:$PORT_FRONT"
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  fi
  success "Открываю $URL"
fi

# --- Tail logs ---
printf "\n${C_INFO}═══════════════════════════════════════════════════════${C_RESET}\n"
printf "${C_INFO}  RAGRAF запущен. Ctrl+C — остановить оба сервиса.${C_RESET}\n"
[ "$OPT_BACK"  -eq 1 ] && printf "${C_BACK}  backend  → http://localhost:$PORT_BACK/docs${C_RESET}\n"
[ "$OPT_FRONT" -eq 1 ] && printf "${C_FRONT}  frontend → http://localhost:$PORT_FRONT${C_RESET}\n"
printf "${C_INFO}═══════════════════════════════════════════════════════${C_RESET}\n\n"

# Префиксированный tail обоих логов
prefix_tail() {
  local color=$1 prefix=$2 file=$3
  tail -n 0 -F "$file" 2>/dev/null | while IFS= read -r line; do
    printf "${color}[%s]${C_RESET} %s\n" "$prefix" "$line"
  done
}

[ "$OPT_BACK"  -eq 1 ] && prefix_tail "$C_BACK"  "back"  "$BACK_LOG"  &
[ "$OPT_FRONT" -eq 1 ] && prefix_tail "$C_FRONT" "front" "$FRONT_LOG" &

# Ждём пока живы основные процессы
while true; do
  [ -n "$BACK_PID" ]  && ! kill -0 "$BACK_PID"  2>/dev/null && fail "backend остановился"  && cleanup
  [ -n "$FRONT_PID" ] && ! kill -0 "$FRONT_PID" 2>/dev/null && fail "frontend остановился" && cleanup
  sleep 1
done

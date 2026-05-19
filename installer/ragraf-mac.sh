#!/usr/bin/env bash
# RAGRAF macOS Launcher — клонирует / обновляет репо, ставит зависимости,
# запускает backend, открывает браузер. Self-contained: всё в ~/RAGRAF.
#
# Запуск:
#   - Двойной клик на start-ragraf.command в Finder, ИЛИ
#   - В Terminal:  bash ragraf-mac.sh
#
# Требования: git, python3 (3.11+), node (18+). Если что-то не установлено,
# скрипт предложит установить через Homebrew.

set -e

# ── Настройки ──────────────────────────────────────────────────────────
INSTALL_DIR="$HOME/RAGRAF"
REPO_URL="https://github.com/Barbashin1970/RAGRAF.git"
BRANCH="main"
PORT=8080
BACKEND_HOST="127.0.0.1"

# ── Цветной вывод ──────────────────────────────────────────────────────
if [ -t 1 ]; then
    BOLD="$(tput bold)"
    CYAN="$(tput setaf 6)"
    GREEN="$(tput setaf 2)"
    YELLOW="$(tput setaf 3)"
    RED="$(tput setaf 1)"
    GRAY="$(tput setaf 8)"
    RESET="$(tput sgr0)"
else
    BOLD=""; CYAN=""; GREEN=""; YELLOW=""; RED=""; GRAY=""; RESET=""
fi

step()  { echo; echo "${CYAN}==> $1${RESET}"; }
ok()    { echo "    ${GREEN}[OK]${RESET} $1"; }
info()  { echo "    ${GRAY}$1${RESET}"; }
warn()  { echo "    ${YELLOW}[!]${RESET} $1"; }
err()   { echo "    ${RED}[ERROR]${RESET} $1"; }

echo
echo "${BOLD}============================================================"
echo "  RAGRAF — локальный запуск для macOS"
echo "============================================================${RESET}"
echo
echo "Этот скрипт:"
echo "  1. Проверит зависимости (git, python3 3.11+, node 18+)"
echo "  2. Скачает или обновит репозиторий с github.com"
echo "  3. Установит backend-зависимости (Python venv)"
echo "  4. Соберёт frontend (npm build)"
echo "  5. Запустит платформу и откроет браузер"
echo
echo "Все данные хранятся локально в ~/RAGRAF"
echo "Никакие данные не уходят за пределы вашего компьютера."

# ── 1. Проверка зависимостей ───────────────────────────────────────────
step "Проверка установленных программ"

check_cmd() {
    local name="$1"
    local cmd="$2"
    if command -v "$cmd" >/dev/null 2>&1; then
        ok "$name найден ($(command -v "$cmd"))"
        return 0
    else
        return 1
    fi
}

MISSING=()
check_cmd "git" "git"       || MISSING+=("git")
check_cmd "python3" "python3" || MISSING+=("python3")
check_cmd "node" "node"     || MISSING+=("node")
check_cmd "npm" "npm"       || MISSING+=("npm")

if [ ${#MISSING[@]} -gt 0 ]; then
    echo
    err "Не установлено: ${MISSING[*]}"
    if command -v brew >/dev/null 2>&1; then
        info "Найден Homebrew — можно установить одной командой:"
        info "  brew install ${MISSING[*]/python3/python@3.11}"
        echo
        read -p "Установить через Homebrew сейчас? (Y/N) [Y]: " resp
        resp=${resp:-Y}
        if [[ "$resp" =~ ^[YyДд]$ ]]; then
            for dep in "${MISSING[@]}"; do
                if [ "$dep" = "python3" ]; then
                    info "brew install python@3.11"
                    brew install python@3.11
                elif [ "$dep" = "git" ]; then
                    info "brew install git"
                    brew install git
                elif [ "$dep" = "node" ] || [ "$dep" = "npm" ]; then
                    info "brew install node (даёт node+npm)"
                    brew install node
                fi
            done
            ok "Установка завершена"
        else
            exit 1
        fi
    else
        info "Homebrew не найден. Установите его одной строкой:"
        info "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        info "Затем перезапустите этот скрипт."
        exit 1
    fi
fi

# Проверка версии Python (>= 3.11)
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
info "Python $PY_VER"
PY_MAJ=$(python3 -c 'import sys; print(sys.version_info[0])')
PY_MIN=$(python3 -c 'import sys; print(sys.version_info[1])')
if [ "$PY_MAJ" -lt 3 ] || ([ "$PY_MAJ" -eq 3 ] && [ "$PY_MIN" -lt 11 ]); then
    err "Нужна Python 3.11+. Установите: brew install python@3.11"
    exit 1
fi

# Проверка версии Node (>= 18)
NODE_VER=$(node --version | sed 's/^v//')
NODE_MAJ=$(echo "$NODE_VER" | cut -d. -f1)
info "Node $NODE_VER"
if [ "$NODE_MAJ" -lt 18 ]; then
    err "Нужна Node.js 18+. Обновите: brew upgrade node"
    exit 1
fi

# ── 2. Клонирование или обновление репозитория ─────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
    step "Проверка обновлений"
    cd "$INSTALL_DIR"
    git fetch origin "$BRANCH" 2>&1 | grep -v "^From " || true
    LOCAL_HEAD=$(git rev-parse HEAD)
    REMOTE_HEAD=$(git rev-parse "origin/$BRANCH")
    SHORT_LOCAL="${LOCAL_HEAD:0:8}"
    SHORT_REMOTE="${REMOTE_HEAD:0:8}"

    if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
        ok "Локальная версия актуальна ($SHORT_LOCAL)"
    else
        warn "Доступна новая версия: $SHORT_LOCAL → $SHORT_REMOTE"
        echo "    ${GRAY}Описание изменений:${RESET}"
        git log --pretty=format:"    * %s" "$LOCAL_HEAD..$REMOTE_HEAD" 2>/dev/null | head -10 || true
        echo
        echo
        read -p "Обновить локальную копию до $SHORT_REMOTE? (Y/N) [Y]: " resp
        resp=${resp:-Y}
        if [[ "$resp" =~ ^[YyДд]$ ]]; then
            info "Обновляю..."
            git pull origin "$BRANCH"
            ok "Обновлено до $SHORT_REMOTE"
        else
            warn "Запуск на текущей версии $SHORT_LOCAL (без обновления)"
        fi
    fi
else
    step "Скачиваю RAGRAF с GitHub"
    info "Папка: $INSTALL_DIR"
    git clone --depth=1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    HEAD=$(git rev-parse HEAD)
    ok "Клонировано в $INSTALL_DIR (commit ${HEAD:0:8})"
fi

# ── 3. Backend: venv + pip install ─────────────────────────────────────
step "Установка Python-зависимостей (backend)"
BACKEND_DIR="$INSTALL_DIR/backend"
cd "$BACKEND_DIR"

VENV_DIR="$BACKEND_DIR/.venv"
VENV_PY="$VENV_DIR/bin/python"

if [ ! -d "$VENV_DIR" ]; then
    info "Создаю виртуальное окружение в .venv"
    python3 -m venv "$VENV_DIR"
fi

info "pip install --upgrade pip"
"$VENV_PY" -m pip install --upgrade pip --quiet --disable-pip-version-check 2>&1 | tail -1 || true

info "pip install -r requirements.txt (это может занять 1-3 минуты)"
"$VENV_PY" -m pip install -r requirements.txt --quiet --disable-pip-version-check
ok "Backend готов"

# ── 4. Frontend: npm install + build ───────────────────────────────────
step "Установка Node-зависимостей и сборка frontend"
FRONTEND_DIR="$INSTALL_DIR/frontend"
cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
    info "npm install (это может занять 2-5 минут)"
    npm install --silent --no-audit --no-fund
fi

info "npm run build"
npm run build --silent
ok "Frontend собран в frontend/dist"

# ── 5. Запуск backend ──────────────────────────────────────────────────
step "Запуск backend"

DATA_DIR="$INSTALL_DIR/data"
STATIC_DIR="$FRONTEND_DIR/dist"
mkdir -p "$DATA_DIR"

# Останавливаем старый процесс на этом порту (если есть от прошлого запуска)
EXISTING_PID=$(lsof -ti tcp:$PORT 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
    warn "Порт $PORT занят процессом $EXISTING_PID — завершаю..."
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 2
fi

# Создаём run-скрипт для удобного перезапуска вручную.
RUN_SCRIPT="$INSTALL_DIR/_run-server.sh"
cat > "$RUN_SCRIPT" <<EOF
#!/usr/bin/env bash
# Auto-generated by ragraf-mac.sh. Прямой запуск сервера без обновления.
export DATA_DIR="$DATA_DIR"
export STATIC_DIR="$STATIC_DIR"
cd "$BACKEND_DIR"
exec "$VENV_PY" -m uvicorn app.main:app --host $BACKEND_HOST --port $PORT
EOF
chmod +x "$RUN_SCRIPT"

# Запуск в новом окне Terminal.app — пользователь видит логи и может закрыть окно для остановки.
info "Открываю новое окно Terminal с сервером..."
osascript <<APPLESCRIPT
tell application "Terminal"
    do script "$RUN_SCRIPT"
    activate
end tell
APPLESCRIPT

# Health-check
step "Ожидание готовности backend"
READY=0
for i in $(seq 1 20); do
    sleep 1
    if curl -sf "http://${BACKEND_HOST}:${PORT}/health" >/dev/null 2>&1; then
        READY=1
        break
    fi
    if [ "$i" -eq 5 ]; then info "ещё жду..."; fi
    if [ "$i" -eq 15 ]; then info "первый старт занимает дольше — DuckDB инициализируется..."; fi
done

if [ "$READY" -eq 1 ]; then
    ok "Backend готов (http://${BACKEND_HOST}:${PORT}/health → 200 OK)"
    step "Открываю браузер"
    open "http://${BACKEND_HOST}:${PORT}"
else
    warn "Backend не ответил на /health за 20 сек."
    warn "Проверьте окно с сервером на ошибки и откройте http://${BACKEND_HOST}:${PORT} вручную."
fi

echo
echo "${GREEN}${BOLD}============================================================${RESET}"
echo "${GREEN}${BOLD}  RAGRAF запущен${RESET}"
echo "${GREEN}${BOLD}============================================================${RESET}"
echo
echo "  URL:          ${CYAN}http://${BACKEND_HOST}:${PORT}${RESET}"
echo "  Папка с ПО:   ${CYAN}$INSTALL_DIR${RESET}"
echo "  Данные:       ${CYAN}$DATA_DIR${RESET}"
echo "  Run-скрипт:   ${CYAN}$RUN_SCRIPT${RESET}  ${GRAY}(прямой запуск без обновления)${RESET}"
echo
echo "Чтобы остановить — закройте окно Terminal с сервером, ИЛИ:"
echo "  ${GRAY}lsof -ti tcp:$PORT | xargs kill${RESET}"
echo
echo "Чтобы перезапустить и проверить обновления — снова откройте start-ragraf.command."
echo

exit 0

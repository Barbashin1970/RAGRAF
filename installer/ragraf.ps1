# RAGRAF Local Launcher (PowerShell)
# Скачивает / обновляет репо, ставит зависимости, запускает backend, открывает браузер.
#
# Запускается из start-ragraf.bat. Прямой запуск: открыть PowerShell,
# выполнить:  powershell -ExecutionPolicy Bypass -File ragraf.ps1
#
# Дизайн self-contained: всё в %USERPROFILE%\RAGRAF, никаких глобальных
# системных правок. Backend пишет данные в %USERPROFILE%\RAGRAF\data\.

$ErrorActionPreference = "Stop"

# ── Настройки ──────────────────────────────────────────────────────────
$InstallDir = Join-Path $env:USERPROFILE "RAGRAF"
$RepoUrl    = "https://github.com/Barbashin1970/RAGRAF.git"
$Branch     = "main"
$Port       = 8080
$BackendHost = "127.0.0.1"

# ── Утилиты вывода ─────────────────────────────────────────────────────
function Write-Step($msg)  { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)    { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Info($msg)  { Write-Host "    $msg" -ForegroundColor Gray }
function Write-Warn($msg)  { Write-Host "    [!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "    [ERROR] $msg" -ForegroundColor Red }

function Test-Command {
    param([string]$Cmd)
    return [bool](Get-Command $Cmd -ErrorAction SilentlyContinue)
}

# ── 1. Проверка зависимостей ───────────────────────────────────────────
Write-Step "Проверка установленных программ"

$deps = @(
    @{ name = "git";    cmd = "git";    url = "https://git-scm.com/download/win" }
    @{ name = "python"; cmd = "python"; url = "https://www.python.org/downloads/" }
    @{ name = "node";   cmd = "node";   url = "https://nodejs.org/" }
    @{ name = "npm";    cmd = "npm";    url = "https://nodejs.org/" }
)
$missing = @()
foreach ($d in $deps) {
    if (Test-Command $d.cmd) {
        Write-OK "$($d.name)"
    } else {
        Write-Err "$($d.name) не установлен — скачайте: $($d.url)"
        $missing += $d.name
    }
}
if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Err "Установите недостающие программы и перезапустите start-ragraf.bat"
    exit 1
}

# Проверка версии Python (>= 3.11)
try {
    $pyMajor = [int](& python -c "import sys; print(sys.version_info[0])" 2>$null)
    $pyMinor = [int](& python -c "import sys; print(sys.version_info[1])" 2>$null)
    Write-Info "Python $pyMajor.$pyMinor"
    if ($pyMajor -lt 3 -or ($pyMajor -eq 3 -and $pyMinor -lt 11)) {
        Write-Err "Нужна Python 3.11+. Установите: https://www.python.org/downloads/"
        exit 1
    }
} catch {
    Write-Err "Не удалось определить версию Python — $_"
    exit 1
}

# Проверка версии Node (>= 18)
try {
    $nodeVer = (& node --version) -replace "^v",""
    $nodeMajor = [int]($nodeVer.Split('.')[0])
    Write-Info "Node $nodeVer"
    if ($nodeMajor -lt 18) {
        Write-Err "Нужна Node.js 18+. Установите: https://nodejs.org/"
        exit 1
    }
} catch {
    Write-Err "Не удалось определить версию Node — $_"
    exit 1
}

# ── 2. Клонирование или обновление репозитория ─────────────────────────
if (Test-Path $InstallDir) {
    Write-Step "Проверка обновлений"
    Set-Location $InstallDir
    # Узнаём текущий и удалённый HEAD
    & git fetch origin $Branch 2>&1 | Out-Null
    $localHead  = (& git rev-parse HEAD).Trim()
    $remoteHead = (& git rev-parse "origin/$Branch").Trim()
    $shortLocal  = $localHead.Substring(0, 8)
    $shortRemote = $remoteHead.Substring(0, 8)

    if ($localHead -eq $remoteHead) {
        Write-OK "Локальная версия актуальна ($shortLocal)"
    } else {
        Write-Warn "Доступна новая версия: $shortLocal → $shortRemote"
        Write-Host "    Описание изменений:" -ForegroundColor Gray
        try {
            & git log "--pretty=format:    * %s" "$localHead..$remoteHead" | Select-Object -First 10 | Write-Host
        } catch {
            Write-Info "(не удалось показать список коммитов)"
        }
        Write-Host ""
        $resp = Read-Host "Обновить локальную копию до $shortRemote? (Y/N) [Y]"
        if ($resp -eq "" -or $resp -eq "Y" -or $resp -eq "y") {
            Write-Info "Обновляю..."
            & git pull origin $Branch
            Write-OK "Обновлено до $shortRemote"
        } else {
            Write-Warn "Запуск на текущей версии $shortLocal (без обновления)"
        }
    }
} else {
    Write-Step "Скачиваю RAGRAF с GitHub"
    Write-Info "Папка: $InstallDir"
    & git clone --depth=1 -b $Branch $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) {
        Write-Err "git clone завершился с ошибкой"
        exit 1
    }
    Set-Location $InstallDir
    $head = (& git rev-parse HEAD).Trim().Substring(0, 8)
    Write-OK "Клонировано в $InstallDir (commit $head)"
}

# ── 3. Установка backend-зависимостей ──────────────────────────────────
Write-Step "Установка Python-зависимостей (backend)"
$BackendDir = Join-Path $InstallDir "backend"
Set-Location $BackendDir

$VenvDir = Join-Path $BackendDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvDir)) {
    Write-Info "Создаю виртуальное окружение в .venv"
    & python -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Не удалось создать venv"
        exit 1
    }
}

Write-Info "pip install --upgrade pip"
& $VenvPython -m pip install --upgrade pip --quiet --disable-pip-version-check 2>&1 | Out-Null

Write-Info "pip install -r requirements.txt (это может занять 1-3 минуты)"
& $VenvPython -m pip install -r requirements.txt --quiet --disable-pip-version-check
if ($LASTEXITCODE -ne 0) {
    Write-Err "pip install завершился с ошибкой"
    exit 1
}
Write-OK "Backend готов"

# ── 4. Установка и сборка frontend ─────────────────────────────────────
Write-Step "Установка Node-зависимостей и сборка frontend"
$FrontendDir = Join-Path $InstallDir "frontend"
Set-Location $FrontendDir

if (-not (Test-Path "node_modules")) {
    Write-Info "npm install (это может занять 2-5 минут)"
    & npm install --silent --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install завершился с ошибкой"
        exit 1
    }
}

# Перезаписываем dist всегда — backend ожидает свежую версию.
Write-Info "npm run build"
& npm run build --silent
if ($LASTEXITCODE -ne 0) {
    Write-Err "Сборка frontend упала"
    exit 1
}
Write-OK "Frontend собран в frontend\dist"

# ── 5. Запуск backend ──────────────────────────────────────────────────
Write-Step "Запуск backend"

# Локальные пути для данных и статики.
$DataDir = Join-Path $InstallDir "data"
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir | Out-Null
}
$StaticDir = Join-Path $FrontendDir "dist"

# Запускаем в отдельном окне терминала — пользователь видит логи и
# может остановить сервер закрытием окна.
$ServerScript = @"
`$env:DATA_DIR = '$DataDir'
`$env:STATIC_DIR = '$StaticDir'
Set-Location '$BackendDir'
& '$VenvPython' -m uvicorn app.main:app --host $BackendHost --port $Port
"@
$ServerScriptPath = Join-Path $InstallDir "_run-server.ps1"
Set-Content -Path $ServerScriptPath -Value $ServerScript -Encoding UTF8

Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$ServerScriptPath`"" `
    -WindowStyle Normal

Write-Info "Backend стартует на http://${BackendHost}:$Port"
Write-Info "Окно с сервером открыто отдельно — закройте его для остановки."

# Ждём health-check
Write-Step "Ожидание готовности backend"
$ready = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri "http://${BackendHost}:$Port/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        # Сервер ещё стартует
    }
    if ($i -eq 5) { Write-Info "ещё жду..." }
    if ($i -eq 15) { Write-Info "первый старт занимает дольше — DuckDB инициализируется..." }
}

if ($ready) {
    Write-OK "Backend готов (http://${BackendHost}:$Port/health → 200 OK)"
    Write-Step "Открываю браузер"
    Start-Process "http://${BackendHost}:$Port"
} else {
    Write-Warn "Backend не ответил на /health за 20 сек."
    Write-Warn "Проверьте окно с сервером на ошибки и откройте http://${BackendHost}:$Port вручную."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  RAGRAF запущен" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  URL:          " -NoNewline; Write-Host "http://${BackendHost}:$Port" -ForegroundColor Cyan
Write-Host "  Папка с ПО:   " -NoNewline; Write-Host $InstallDir -ForegroundColor Cyan
Write-Host "  Данные:       " -NoNewline; Write-Host $DataDir -ForegroundColor Cyan
Write-Host ""
Write-Host "Чтобы остановить — закройте окно с сервером."
Write-Host "Чтобы перезапустить и проверить обновления — снова откройте start-ragraf.bat."
Write-Host ""
exit 0

@echo off
REM RAGRAF - локальный запуск (Windows).
REM Двойной клик в Explorer или start.bat в cmd.
REM
REM Флаги:
REM   --no-open       не открывать браузер
REM   --backend-only  поднять только бэкенд
REM   --frontend-only поднять только фронт
REM   --reset-deps    переустановить venv и node_modules
REM   --port-back=N   порт бэкенда (default 8000)
REM   --port-front=N  порт фронта  (default 5173)
REM
REM Self-healing:
REM   Если предыдущий запуск умер некорректно (закрыли крестиком, упал свет
REM   и т.п.), процессы uvicorn/node могут остаться висеть на портах. Скрипт
REM   обнаруживает это на старте и аккуратно прибивает по эскалации
REM   taskkill /T → taskkill /F /T → проверка → fail с инструкциями.

setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"

set PROJECT_ROOT=%cd%
set BACKEND_DIR=%PROJECT_ROOT%\backend
set FRONTEND_DIR=%PROJECT_ROOT%\frontend
set VENV_DIR=%BACKEND_DIR%\.venv
set LOG_DIR=%PROJECT_ROOT%\logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set OPT_OPEN=1
set OPT_BACK=1
set OPT_FRONT=1
set OPT_RESET=0
set PORT_BACK=8000
set PORT_FRONT=5173

:parse
if "%~1"=="" goto :after_parse
if /i "%~1"=="--no-open" set OPT_OPEN=0
if /i "%~1"=="--backend-only" set OPT_FRONT=0
if /i "%~1"=="--frontend-only" set OPT_BACK=0
if /i "%~1"=="--reset-deps" set OPT_RESET=1
echo %~1 | findstr /b /c:"--port-back=" >nul && for /f "tokens=2 delims==" %%a in ("%~1") do set PORT_BACK=%%a
echo %~1 | findstr /b /c:"--port-front=" >nul && for /f "tokens=2 delims==" %%a in ("%~1") do set PORT_FRONT=%%a
if /i "%~1"=="-h" goto :help
if /i "%~1"=="--help" goto :help
shift
goto :parse

:help
echo Использование: start.bat [--no-open] [--backend-only ^| --frontend-only] [--reset-deps] [--port-back=N] [--port-front=N]
goto :final

:after_parse

REM ============================================================
REM Self-healing preflight: чистим зомби-процессы прошлой сессии
REM ============================================================
REM Закрытие крестиком оставляет uvicorn worker'а и node.exe висеть на портах,
REM а курильный curl /health отвечает ЗОМБИ → ложный «Backend готов» и
REM мгновенный ERR_CONNECTION_REFUSED у пользователя. Эскалация: TERM → KILL.

if "%OPT_BACK%"=="1"  call :ensure_port_free %PORT_BACK% backend || goto :final
if "%OPT_FRONT%"=="1" call :ensure_port_free %PORT_FRONT% frontend || goto :final

REM Подчищаем DuckDB temp-файлы от ungraceful-shutdown (сам .duckdb и .wal не трогаем —
REM DuckDB сама делает WAL-recovery при следующем открытии).
if exist "%BACKEND_DIR%\data\*.duckdb.tmp" del /q "%BACKEND_DIR%\data\*.duckdb.tmp" >nul 2>nul

REM --- Setup backend ---
if "%OPT_BACK%"=="1" (
  where python >nul 2>nul
  if errorlevel 1 (
    echo [ERR] python не найден. Установите Python 3.10+ и повторите.
    goto :final
  )
  if "%OPT_RESET%"=="1" if exist "%VENV_DIR%" (
    echo [INFO] Удаляю старый venv...
    rmdir /s /q "%VENV_DIR%"
  )
  if not exist "%VENV_DIR%" (
    echo [INFO] Создаю venv для backend...
    python -m venv "%VENV_DIR%"
    "%VENV_DIR%\Scripts\pip.exe" install -q --upgrade pip
  )
  "%VENV_DIR%\Scripts\python.exe" -c "import fastapi, uvicorn, rdflib, pyshacl, httpx, networkx" 2>nul
  if errorlevel 1 (
    echo [INFO] Устанавливаю зависимости backend...
    "%VENV_DIR%\Scripts\pip.exe" install -q -r "%BACKEND_DIR%\requirements.txt"
  )
  if not exist "%BACKEND_DIR%\.env" if exist "%BACKEND_DIR%\.env.example" (
    copy /y "%BACKEND_DIR%\.env.example" "%BACKEND_DIR%\.env" >nul
    echo [INFO] Создан backend\.env из .env.example
  )
)

REM --- Setup frontend ---
if "%OPT_FRONT%"=="1" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERR] node не найден. Установите Node.js 18+ и повторите.
    goto :final
  )
  if "%OPT_RESET%"=="1" if exist "%FRONTEND_DIR%\node_modules" (
    echo [INFO] Удаляю node_modules...
    rmdir /s /q "%FRONTEND_DIR%\node_modules"
  )
  if not exist "%FRONTEND_DIR%\node_modules" (
    echo [INFO] Устанавливаю зависимости frontend...
    pushd "%FRONTEND_DIR%"
    call npm install --no-audit --no-fund --loglevel=error
    popd
  )
)

REM --- Start backend ---
if "%OPT_BACK%"=="1" (
  echo [INFO] Стартую backend на http://localhost:%PORT_BACK% ...
  start "RAGRAF backend" /min cmd /c ""%VENV_DIR%\Scripts\uvicorn.exe" app.main:app --host 127.0.0.1 --port %PORT_BACK% --reload --app-dir "%BACKEND_DIR%" > "%LOG_DIR%\backend.log" 2>&1"
  call :wait_health %PORT_BACK% 30 backend || (
    echo [ERR] Backend не поднялся. Последние строки backend.log:
    if exist "%LOG_DIR%\backend.log" powershell -nop -c "Get-Content '%LOG_DIR%\backend.log' -Tail 20"
    call :cleanup_all
    goto :final
  )
  echo [OK] Backend готов.
)

REM --- Start frontend ---
if "%OPT_FRONT%"=="1" (
  echo [INFO] Стартую frontend на http://localhost:%PORT_FRONT% ...
  start "RAGRAF frontend" /min cmd /c "cd /d "%FRONTEND_DIR%" && set VITE_API_PROXY=http://127.0.0.1:%PORT_BACK%&& set VITE_PORT=%PORT_FRONT%&& npm run dev -- --host 127.0.0.1 --port %PORT_FRONT% > "%LOG_DIR%\frontend.log" 2>&1"
  call :wait_health %PORT_FRONT% 60 frontend || (
    echo [ERR] Frontend не поднялся. Последние строки frontend.log:
    if exist "%LOG_DIR%\frontend.log" powershell -nop -c "Get-Content '%LOG_DIR%\frontend.log' -Tail 20"
    call :cleanup_all
    goto :final
  )
  echo [OK] Frontend готов.
)

REM --- Open browser ---
if "%OPT_OPEN%"=="1" if "%OPT_FRONT%"=="1" (
  start "" "http://localhost:%PORT_FRONT%"
)

echo.
echo ═══════════════════════════════════════════════════════
echo   RAGRAF запущен.
if "%OPT_BACK%"=="1"  echo   backend  ^> http://localhost:%PORT_BACK%/docs
if "%OPT_FRONT%"=="1" echo   frontend ^> http://localhost:%PORT_FRONT%
echo   Логи: %LOG_DIR%\backend.log, %LOG_DIR%\frontend.log
echo.
echo   Чтобы корректно ОСТАНОВИТЬ всё — нажми Ctrl+C в этом окне
echo   (или просто закрой крестиком: следующий запуск сам почистит
echo   зомби-процессы преflight'ом).
echo ═══════════════════════════════════════════════════════
echo.

REM --- Main monitor loop ---
REM Опрашиваем порты раз в 2 секунды. Если бэк или фронт перестали слушать —
REM значит упали; чистим всё и выходим. Это закрывает «фронт работает, бэк
REM лёг» состояние когда юзер бы увидел 502 в браузере без понимания причины.
:monitor
ping -n 3 127.0.0.1 >nul 2>nul
if "%OPT_BACK%"=="1" (
  netstat -ano -p tcp | findstr ":%PORT_BACK% " | findstr LISTENING >nul 2>nul
  if errorlevel 1 (
    echo [ERR] Backend перестал отвечать на :%PORT_BACK%.
    call :cleanup_all
    goto :final
  )
)
if "%OPT_FRONT%"=="1" (
  netstat -ano -p tcp | findstr ":%PORT_FRONT% " | findstr LISTENING >nul 2>nul
  if errorlevel 1 (
    echo [ERR] Frontend перестал отвечать на :%PORT_FRONT%.
    call :cleanup_all
    goto :final
  )
)
goto :monitor

REM ============================================================
REM Functions
REM ============================================================

:ensure_port_free
REM %1 — порт, %2 — имя для сообщений.
REM Эскалация: SIGTERM (taskkill /T) → SIGKILL (taskkill /F /T) → verify.
set _port=%~1
set _name=%~2
set _attempt=0
:retry_free
set /a _attempt+=1
set _found=0
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr ":%_port% " ^| findstr LISTENING') do (
  if not "%%P"=="0" (
    set _found=1
    if !_attempt! equ 1 (
      echo [INFO] Порт %_port% (%_name%) занят прошлой сессией ^(PID %%P^) — освобождаю...
      taskkill /T /PID %%P >nul 2>nul
    ) else if !_attempt! equ 2 (
      echo [INFO] Не отпустили — применяю /F...
      taskkill /F /T /PID %%P >nul 2>nul
    ) else (
      echo [ERR] Порт %_port% занят процессом %%P, освободить не получилось.
      echo       Возможно это не наш процесс. Запусти на другом порту:
      echo         start.bat --port-back=8001
      exit /b 1
    )
  )
)
if !_found! equ 1 (
  if !_attempt! lss 3 (
    ping -n 2 127.0.0.1 >nul 2>nul
    goto :retry_free
  )
)
exit /b 0

:wait_health
REM %1 — порт, %2 — таймаут в попытках по 1 сек, %3 — имя.
REM Проверяет что порт реально слушается КЕМ-ТО (после preflight это гарантированно наш процесс).
set _port=%~1
set _tries=%~2
set _count=0
:wait_loop
ping -n 2 127.0.0.1 >nul 2>nul
netstat -ano -p tcp | findstr ":%_port% " | findstr LISTENING >nul 2>nul
if not errorlevel 1 exit /b 0
set /a _count+=1
if !_count! geq !_tries! exit /b 1
goto :wait_loop

:cleanup_all
echo [INFO] Останавливаю процессы...
if "%OPT_BACK%"=="1"  call :force_kill_port %PORT_BACK%
if "%OPT_FRONT%"=="1" call :force_kill_port %PORT_FRONT%
REM Дополнительно прибиваем заголовочные cmd-окна (RAGRAF backend / RAGRAF frontend).
taskkill /F /FI "WINDOWTITLE eq RAGRAF backend*"  >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq RAGRAF frontend*" >nul 2>nul
echo [OK] Готово. Логи: %LOG_DIR%\backend.log, %LOG_DIR%\frontend.log
exit /b 0

:force_kill_port
REM Жёсткое убийство всего, кто слушает порт %1 (с поддеревом).
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr ":%~1 " ^| findstr LISTENING') do (
  if not "%%P"=="0" taskkill /F /T /PID %%P >nul 2>nul
)
exit /b 0

:final
REM Финальная пауза только если запускали двойным кликом (нет родительского cmd).
REM При запуске из cmd /c НЕ паузим — иначе скрипт не возвращает управление.
echo.
pause >nul
endlocal

@echo off
REM RAGRAF - локальный запуск (Windows).
REM Двойной клик в Explorer или start.bat в cmd.
REM
REM Флаги:
REM   --no-open       не открывать браузер
REM   --backend-only  поднять только бэкенд
REM   --frontend-only поднять только фронт
REM   --reset-deps    переустановить venv и node_modules

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
if /i "%~1"=="-h" goto :help
if /i "%~1"=="--help" goto :help
shift
goto :parse

:help
echo Использование: start.bat [--no-open] [--backend-only ^| --frontend-only] [--reset-deps]
goto :eof

:after_parse

REM --- Setup backend ---
if "%OPT_BACK%"=="1" (
  where python >nul 2>nul
  if errorlevel 1 (
    echo [ERR] python не найден. Установите Python 3.10+ и повторите.
    exit /b 1
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
    exit /b 1
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
)

REM --- Start frontend ---
if "%OPT_FRONT%"=="1" (
  echo [INFO] Стартую frontend на http://localhost:%PORT_FRONT% ...
  start "RAGRAF frontend" /min cmd /c "cd /d "%FRONTEND_DIR%" && set VITE_API_PROXY=http://127.0.0.1:%PORT_BACK%&& set VITE_PORT=%PORT_FRONT%&& npm run dev -- --host 127.0.0.1 --port %PORT_FRONT% > "%LOG_DIR%\frontend.log" 2>&1"
)

REM --- Wait a bit and open browser ---
if "%OPT_OPEN%"=="1" if "%OPT_FRONT%"=="1" (
  echo [INFO] Жду готовности фронта...
  timeout /t 6 /nobreak >nul
  start "" "http://localhost:%PORT_FRONT%"
)

echo.
echo ═══════════════════════════════════════════════════════
echo   RAGRAF запущен.
if "%OPT_BACK%"=="1"  echo   backend  → http://localhost:%PORT_BACK%/docs
if "%OPT_FRONT%"=="1" echo   frontend → http://localhost:%PORT_FRONT%
echo   Логи: %LOG_DIR%\backend.log, %LOG_DIR%\frontend.log
echo   Окна backend/frontend свёрнуты в трее — закройте их для остановки.
echo ═══════════════════════════════════════════════════════
echo.
pause

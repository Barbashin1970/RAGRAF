@echo off
setlocal
title RAGRAF Launcher
cd /d "%~dp0"
echo.
echo  ============================================================
echo   RAGRAF - локальный запуск (для аналитиков заказчика)
echo  ============================================================
echo.
echo  Этот скрипт:
echo    1. Проверит зависимости (git, python 3.11+, node 18+)
echo    2. Скачает или обновит репозиторий с github.com
echo    3. Установит backend-зависимости (Python venv)
echo    4. Соберёт frontend (npm build)
echo    5. Запустит платформу и откроет браузер
echo.
echo  Все данные хранятся локально в %%USERPROFILE%%\RAGRAF
echo  Никакие данные не уходят за пределы вашего компьютера.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ragraf.ps1"
set "_exit=%errorlevel%"

echo.
if not "%_exit%"=="0" (
    echo [!] Запуск завершился с ошибкой ^(код %_exit%^).
    echo     Прочтите сообщения выше и устраните проблему.
) else (
    echo RAGRAF успешно запущен. Это окно можно закрыть.
)
echo.
echo Нажмите любую клавишу для выхода...
pause >nul
endlocal
exit /b %_exit%

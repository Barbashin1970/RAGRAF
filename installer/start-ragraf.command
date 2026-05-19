#!/usr/bin/env bash
# RAGRAF Mac Launcher — двойной клик на .command файле в Finder открывает
# Terminal и запускает этот скрипт. Альтернатива: открыть Terminal,
# перетащить .command файл в окно → Enter.

set -e

# Чтобы пути работали независимо от текущей директории Terminal'а:
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Запускаем основной скрипт; чтобы окно Terminal не закрылось после ошибки,
# обрабатываем exit code и держим окно открытым на «нажмите Enter».
bash "$SCRIPT_DIR/ragraf-mac.sh"
RC=$?

echo
if [ $RC -ne 0 ]; then
    echo "[!] Запуск завершился с ошибкой (код $RC)."
    echo "    Прочтите сообщения выше и устраните проблему."
else
    echo "RAGRAF успешно запущен. Это окно можно закрыть."
fi
echo
read -p "Нажмите Enter для выхода..."
exit $RC

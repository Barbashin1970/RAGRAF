# Установка RAGRAF на macOS для аналитика заказчика

> RAGRAF — это локальное ПО для проектирования цифрового двойника управленческих процессов.
> Все данные хранятся на компьютере аналитика. Никакие данные не уходят за пределы
> вашей машины.
>
> Минимальные требования: macOS 11 Big Sur+ (Intel или Apple Silicon).

## 🟢 Быстрый старт (5 минут)

### 1. Скачайте установщик

С главной страницы [RAGRAF на GitHub](https://github.com/Barbashin1970/RAGRAF) скачайте файл
**`start-ragraf.command`** в любую папку (например, на Рабочий стол).

```bash
curl -O https://raw.githubusercontent.com/Barbashin1970/RAGRAF/main/installer/start-ragraf.command
curl -O https://raw.githubusercontent.com/Barbashin1970/RAGRAF/main/installer/ragraf-mac.sh
chmod +x start-ragraf.command ragraf-mac.sh
```

> Скачайте **оба файла** в одну папку. `start-ragraf.command` — точка входа,
> `ragraf-mac.sh` — основная логика.

### 2. Установите 3 программы (один раз)

Самый простой способ — через **Homebrew**.

#### 2.1. Установите Homebrew (если его нет)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

После установки Homebrew **закройте и заново откройте Terminal**, чтобы команда `brew` стала доступна.

#### 2.2. Установите git, python и node

Если скрипт `start-ragraf.command` обнаружит, что чего-то не хватает, и
Homebrew у вас уже есть — он предложит установить недостающее одной
командой и спросит подтверждение (Y/N).

Можно установить заранее вручную:

```bash
brew install git python@3.11 node
```

### 3. Запустите `start-ragraf.command`

Двойной клик в Finder → откроется Terminal. Скрипт:

1. Проверит, что Git / Python / Node установлены (предложит `brew install` если нет).
2. Скачает RAGRAF в `~/RAGRAF/` (если ещё нет).
3. Если RAGRAF уже скачан — проверит обновления на GitHub и спросит «Обновить? (Y/N)».
4. Установит зависимости (1-5 минут первый раз).
5. Соберёт фронтенд (1-2 минуты).
6. Запустит сервер в **новом окне Terminal**.
7. Откроет браузер на http://127.0.0.1:8080.

**Первый запуск** занимает 5-10 минут. **Последующие** — 10-20 секунд.

### ⚠️ Gatekeeper: «macOS cannot verify the developer»

При первом двойном клике macOS может заблокировать запуск с сообщением
«Apple cannot check it for malicious software». Это потому что файл скачан
из интернета и не подписан.

**Разблокировка одним из способов:**

**Способ 1 (просто):** в Finder → правый клик на `start-ragraf.command` →
**«Открыть»** в контекстном меню → во всплывшем окне «Открыть» снова.
После одного такого запуска macOS запомнит файл как доверенный.

**Способ 2 (через Terminal):**
```bash
xattr -d com.apple.quarantine ~/Desktop/start-ragraf.command
xattr -d com.apple.quarantine ~/Desktop/ragraf-mac.sh
```
И затем — двойной клик.

**Способ 3:** в **System Settings → Privacy & Security**, после блокированной
попытки запуска появится кнопка «Open Anyway» — нажмите её.

### 4. Работайте в браузере

После открытия http://127.0.0.1:8080 — вы видите тёплый бежевый интерфейс с
навигацией: Студия аналитика, Регламенты, Датчики, Модули, Аудит,
Граф связей, Цифровой двойник.

Все данные пишутся в `~/RAGRAF/data/`. Для бэкапа — копируйте эту папку.

### 5. Чтобы остановить

Закройте окно Terminal с заголовком «ragraf-mac.sh» / «_run-server.sh» (там логи uvicorn).

Альтернатива из любого Terminal:
```bash
lsof -ti tcp:8080 | xargs kill
```

## 🔄 Обновление

При очередном запуске `start-ragraf.command` скрипт сам проверит наличие
обновлений на GitHub:

```
==> Проверка обновлений
    [!] Доступна новая версия: a1b2c3d4 → e5f6g7h8
        Описание изменений:
        * фикс 049 — Windows-инсталлер
        * фикс 048 — UI аудит-журнала
        * фикс 047 — sensor pill без subtype
    Обновить локальную копию до e5f6g7h8? (Y/N) [Y]:
```

Нажмите **Enter** (или Y) — Git подтянет последний коммит и пересоберёт фронтенд.
**Ваши данные в `~/RAGRAF/data/` не затрагиваются** при обновлении кода.

Если хотите остаться на старой версии — нажмите N. Платформа запустится на
текущей версии.

## 📁 Что и где хранится

```
~/RAGRAF/                          ← корень установки
├── backend/                        ← Python-сервер
│   └── .venv/                      ← виртуальное окружение Python
├── frontend/                       ← React-фронт
│   ├── node_modules/               ← Node-зависимости
│   └── dist/                       ← собранная SPA (отдаётся backend'ом)
├── data/                           ← ВАШИ ДАННЫЕ (бэкапьте отсюда)
│   ├── regulations.duckdb          ← регламенты + аудит-журнал
│   ├── fixtures/                   ← seed-фикстуры (можно править)
│   ├── flows/                      ← flow.json регламентов
│   └── versions/                   ← история версий
└── _run-server.sh                  ← скрипт прямого запуска (без update)
```

Для прямого запуска без обновления (например после `git pull` руками):

```bash
~/RAGRAF/_run-server.sh
```

## 🛠 Troubleshooting

### «git не установлен»
```bash
brew install git
```
Или используйте Xcode Command Line Tools — `xcode-select --install`.

### «python3: command not found»
```bash
brew install python@3.11
```
После установки добавьте `/opt/homebrew/opt/python@3.11/bin` в PATH
(Homebrew покажет инструкцию).

### «node: command not found»
```bash
brew install node
```

### Порт 8080 занят
```bash
lsof -ti tcp:8080 | xargs kill
~/RAGRAF/_run-server.sh
```

Или измените порт в `ragraf-mac.sh` (переменная `PORT`).

### Apple Silicon (M1/M2/M3): «cannot find module — wrong architecture»
Скорее всего Node установлен под Rosetta. Переустановите через нативный Homebrew:
```bash
brew uninstall node
arch -arm64 brew install node
```

### Хочу полностью переустановить
```bash
rm -rf ~/RAGRAF
~/Desktop/start-ragraf.command   # двойной клик
```
(Внимание: удалит и `data/` — это сбросит ваши регламенты.)

### Хочу сохранить данные, но переустановить код
```bash
cp -r ~/RAGRAF/data ~/Desktop/ragraf-data-backup
rm -rf ~/RAGRAF
~/Desktop/start-ragraf.command   # скачает свежий код
# После запуска остановите сервер и:
rm -rf ~/RAGRAF/data
mv ~/Desktop/ragraf-data-backup ~/RAGRAF/data
~/RAGRAF/_run-server.sh
```

## 🔐 Безопасность

- Платформа слушает только на **127.0.0.1** (loopback) — снаружи компьютера
  недоступна. Если нужен сетевой доступ для коллег, поменяйте `BACKEND_HOST`
  в `ragraf-mac.sh` на `0.0.0.0` (на свой страх и риск).
- Никакие данные не отправляются за пределы вашего компьютера. Платформа
  работает **offline** после первого скачивания зависимостей.
- Лицензия указана в репозитории на GitHub. По всем вопросам интеграции —
  обращайтесь к авторам.

## 📞 Контакты для интеграции

- GitHub Issues: https://github.com/Barbashin1970/RAGRAF/issues
- Email для коммерческого использования и интеграций с региональными
  системами (СИГМА, ЕДДС, СКД, BMS): см. README репозитория.

---

**Версия инструкции:** 2026-05-19. Соответствует коду от commit `97dadea` и выше.

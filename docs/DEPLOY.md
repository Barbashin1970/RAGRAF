# Деплой RAGRAF на Railway

Полный путь от «у меня есть git и Railway-аккаунт» до «по публичному URL
открывается работающее приложение». Монокон­тейнер — фронт (Vite-build)
и бэкенд (FastAPI/uvicorn) живут в одном Docker-образе, отдаются с одного
порта. Минимум платных компонентов, никакого split-deploy.

---

## TL;DR — 5 действий

1. **Запушить ветку в GitHub** (Railway подхватывает по webhook'у).
2. На Railway создать сервис из репозитория. **Root Directory = `/`**, builder
   подхватится автоматически из `railway.json`.
3. **Добавить Volume** на путь `/data`, размер 1 ГБ.
4. **Прописать Variables** (см. секцию ниже). Минимум — `LLM_PROVIDER`, `OPENAI_BASE_URL`,
   `OPENAI_API_KEY`, `RAGU_LLM_MODEL`, `USE_FIXTURES=true`.
5. **Дождаться зелёного healthcheck** на `/api/health` → открыть public URL.

Через 5-6 минут после `git push` приложение обновляется автоматически.

---

## 1. Что лежит в репозитории

| Файл | Назначение |
|---|---|
| [`Dockerfile`](Dockerfile) | Multi-stage: Node 20 → собирает `frontend/dist/`; Python 3.12-slim → ставит зависимости, кладёт SPA рядом с FastAPI. |
| [`start.sh`](start.sh) | Entrypoint контейнера. Дроп с root до `ragraf:1000` (Volume на Railway монтируется root'ом), seed `/data` из `_seed_data/` при первом запуске, потом `uvicorn`. |
| [`railway.json`](railway.json) | `builder=DOCKERFILE`, `healthcheckPath=/api/health`, `healthcheckTimeout=90`, `restartPolicyType=ON_FAILURE`. |
| [`.dockerignore`](.dockerignore) | Отрезает `.venv/`, `node_modules/`, документацию, бэкапы DuckDB — экономит ~150 МБ в build context'е. |
| [`.railwayignore`](.railwayignore) | Аналогично, на этапе upload архива в Railway (до docker build). |

Все четыре файла **обязаны лежать в корне репозитория**. Railway сканирует
корень при первом обнаружении; если `railway.json` положить в подкаталог —
автодетектор Railpack пытается угадать стек и часто промахивается на
monorepo.

---

## 2. Архитектура одного контейнера

```
            Railway publik HTTPS endpoint (Railway proxy → :PORT)
                              │
                              ▼
                    ┌─────────────────────┐
                    │  uvicorn $PORT      │   один процесс
                    │  ↓                  │
                    │  FastAPI app        │
                    │  ├ /api/* — роутеры │   (53 endpoint'а)
                    │  ├ /api/health      │   ← Railway healthcheck
                    │  ├ /assets/* — JS/CSS bundled by Vite
                    │  └ /* — index.html  │   (catch-all для React Router)
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Volume /data (1 ГБ)│
                    │  ├ regulations.duckdb  ← основной store
                    │  ├ regulations.duckdb.wal
                    │  ├ flows/              ← snapshot'ы Rule DSL
                    │  ├ versions/           ← snapshot'ы регламентов
                    │  └ source_documents/   ← пуст в демо
                    └─────────────────────┘
```

Без двух процессов и без Node-runtime — FastAPI сам отдаёт SPA через
`StaticFiles` + catch-all-роут. Это упрощает `start.sh` и снимает
`HOSTNAME=container-id`-баг Railway (Next.js standalone подхватывает
injected hostname как bind-address, у нас этой проблемы нет).

---

## 3. Шаги в Railway dashboard

### 3.1 Создание сервиса

1. **New Project** → **Deploy from GitHub repo** → выбрать репозиторий RAGRAF.
2. Service Settings → **Source**:
   - Repo: `<твой-аккаунт>/RAGRAF`
   - Branch: `main`
   - **Root Directory: `/`** ⚠ — не `/backend`, не `/frontend`. Build context
     должен включать оба для Dockerfile.
3. Build: Railway автоматически читает `railway.json` → `builder: DOCKERFILE`.
4. Healthcheck path: `/api/health` (читается из `railway.json`).

### 3.2 Volume

1. Service Settings → **Volumes** → **+ New Volume**:
   - **Mount Path: `/data`**
   - **Size: 1 GB** (Railway minimum; для демо хватит с ×20 запасом, см.
     раздел «Расчёт места» ниже).
2. После первого деплоя Railway смонтирует Volume; `start.sh` обнаружит
   что `/data` пуст и скопирует туда seed-данные из встроенного
   `/srv/_seed_data` (8 регламентов + фикстуры).

### 3.3 Variables — минимальный набор для демо

В **Service Settings → Variables**:

```env
# ── LLM (облачный chat, без локальной Ollama) ─────────────────────────
LLM_PROVIDER=cerebras
OPENAI_BASE_URL=https://api.cerebras.ai/v1
OPENAI_API_KEY=csk-...                          # ← из cloud.cerebras.ai
RAGU_LLM_MODEL=qwen-3-235b-a22b-instruct-2507

# ── Embeddings: выключены на Railway ──────────────────────────────────
# Cerebras не предоставляет embeddings; локальной Ollama тут нет.
# Семантический поиск падает в keyword-only mode (TF-IDF), загрузка PDF
# заблокирована (503). Этого достаточно для демо 7 seed-регламентов.
EMBEDDINGS_ENABLED=false

# ── Upstream Sigma — недоступен с Railway по приватному IP ────────────
USE_FIXTURES=true
WRITEBACK_UPSTREAM=false

# ── CORS — Railway сам подставит public URL после первого деплоя ──────
# Когда узнаешь свой URL (типа https://ragraf-production.up.railway.app),
# впиши его сюда. До этого можно оставить wildcard `*` для удобства.
CORS_ORIGINS=https://ragraf-production.up.railway.app
```

Railway инжектит `PORT` сам — не нужно прописывать.

### 3.4 Public domain

После первого зелёного деплоя:
- Service Settings → **Networking → Generate Domain** → получишь
  `https://<имя>.up.railway.app`. Сразу работает.
- Custom domain (опционально): Networking → Custom Domain → следовать
  инструкции по DNS. На Cloudflare ставить SSL/TLS = «Full (strict)»,
  иначе redirect-loop.

---

## 4. Расчёт места на Volume

| Каталог | Сейчас | После 6 мес демо-нагрузки (~500 правок) |
|---|---:|---:|
| `regulations.duckdb` + `.wal` | 2.7 MB | ~15-30 MB |
| `versions/` | 176 KB | ~5 MB |
| `flows/` | 76 KB | ~5 MB |
| `ragu_store/` | 0 (отключён без embeddings) | 0 |
| `source_documents/` | 0 (без embeddings PDF-upload заблокирован) | 0 |
| **Итого** | **~3 MB** | **~40-50 MB** |

**Вывод:** 1 ГБ Volume — ×20 запас. Free Trial / Hobby tier Railway
бесплатно даёт до **5 ГБ** Volume.

---

## 5. Что происходит при `git push`

```
┌──────────────┐  git push   ┌──────────────────┐
│   VS Code    │ ──────────▶ │  GitHub main     │
└──────────────┘             └────────┬─────────┘
                                      │ webhook
                                      ▼
                          ┌────────────────────────┐
                          │ Railway build pipeline │
                          │  1. .railwayignore     │
                          │  2. .dockerignore      │
                          │  3. docker build       │
                          │     Stage 1: npm ci    │
                          │                +build  │
                          │     Stage 2: pip       │
                          │                +copy   │
                          │  4. push to registry   │
                          │  5. container restart  │
                          │  6. healthcheck /api/h │
                          └──────────┬─────────────┘
                                     │ (когда 200)
                                     ▼
                          ┌────────────────────────┐
                          │  публично доступно     │
                          └────────────────────────┘
```

Время сборки — **3-5 минут**: stage 1 (Vite) ~1 мин, stage 2 (pip) ~1 мин,
COPY+finalize ~1 мин.

---

## 6. Локальная проверка Docker-сборки

Перед первым push'ем стоит убедиться, что image собирается:

```bash
cd /Users/olegbarbashin/RAGRAF
docker build -t ragraf:dev .
docker run --rm -p 8080:8080 \
    -e LLM_PROVIDER=mock \
    -e USE_FIXTURES=true \
    -v "$(pwd)/_ragraf_data_local:/data" \
    ragraf:dev
# В новой вкладке:
curl http://localhost:8080/api/health        # {"status":"ok"}
curl -s http://localhost:8080/ | head -1     # <!doctype html> от Vite
```

В mock-режиме ключи не нужны — это быстрый smoke-test что контейнер
поднимается, /api/health отвечает, SPA отдаётся.

---

## 7. Подводные камни и решения

| Симптом | Причина | Что делать |
|---|---|---|
| `Healthcheck failed` после 90 сек | DuckDB-сидинг долгий или /data unwritable | Смотреть Railway logs: должна быть строка `==> seed copied`. Если её нет — Volume не примонтирован или права не дочитались. |
| `502 Bad Gateway` сразу | uvicorn упал на старте | Логи Railway → ищем traceback от FastAPI. Чаще всего — отсутствует обязательная env переменная (`OPENAI_API_KEY` для cloud-провайдера). |
| `404` на любой не-`/api/*` маршрут | SPA-catch-all не нашёл `index.html` | Проверить что `STATIC_DIR=/srv/frontend_dist` (set в Dockerfile, не переопределять в Variables). Логи покажут «SPA index.html not found». |
| Ответ LLM не приходит, mock-сообщение | Cerebras 400 / 401 | Проверить `OPENAI_API_KEY` валиден, `RAGU_LLM_MODEL` есть в `https://api.cerebras.ai/v1/models`. |
| `/api/sandbox/documents/upload` → 503 | По задумке: `EMBEDDINGS_ENABLED=false` | Это нормально для cloud-демо. Чтобы включить — нужен embedding-провайдер (Gemini text-embedding или локальный bge-m3). |
| Image занимает 2+ ГБ | `.dockerignore` не подхватился | Проверить что файл в корне репо (не в `backend/`). `docker build` должен печатать `transferring context: ... ~20 MB`, не 500. |
| Volume теряется при ребилде | Ничего: Railway Volume переживает ребилды | Только при удалении сервиса. Backup можно делать через `railway run sh -c "tar czf - /data" > backup.tar.gz`. |

---

## 8. Откат

### 8.1 Через Railway dashboard
Deployments → найти предыдущий successful → **«Redeploy»**. Image
хранится 30 дней.

### 8.2 Через git
```bash
git revert <bad-commit-sha>
git push
# Railway автоматически разворачивает через 4-5 минут.
```

---

## 9. Что не делаем на Railway-демо

| Фича | Почему отключена | Включить когда |
|---|---|---|
| Загрузка PDF/DOCX | `EMBEDDINGS_ENABLED=false` | Подключим Gemini text-embedding-004 (free) или поднимем worker с Ollama. |
| Семантический поиск через bge-m3 | Тот же | Тот же. |
| Writeback в upstream Sigma | Upstream IP приватный | Только в локальной dev-сетке. |
| Реальный ETL `/api/events/ingest` | В бэклоге | Когда появится боевой источник. |

---

## 10. Связанные документы

- [README.md](../README.md) — quickstart для разработчика.
- [ARC.md](ARC.md) — общая архитектура RAGRAF.
- [ARC-SIGMA.md](ARC-SIGMA.md) — место RAGRAF в архитектуре СИГМЫ.
- [BACKLOG.md](BACKLOG.md) — что в очереди.
- `POLINOM/web-playground/SKILL-DEPLOY.md` — прототип паттерна, откуда
  взято решение (multi-stage Dockerfile, runuser-drop, seed-on-empty-Volume).

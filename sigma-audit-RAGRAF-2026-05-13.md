# Sigma audit report — RAGRAF

**Project:** RAGRAF · визуализатор и редактор регламентов
**Skill version:** sigma v0.5.4
**Audit date:** 2026-05-13
**Stacks scanned:** Python (backend) + TypeScript/React (frontend, TS profile)
**Methodology:** read-only AST + grep, верификация чтением 5–10 строк вокруг hit'а
**Code execution:** none

## Per-stack scores

| Stack | LOC | Files | Penalty | Score |
|-------|----:|------:|--------:|------:|
| **Sigma-Python**  | 2 628 | 26 | 65 | **75.3 / 100** |
| **Sigma-Frontend** (TS) | 3 093 | 20 | 16 | **94.8 / 100** |

> Скоры считаются отдельно (по правилу v0.5.4 «never blend»). Низкий Python-балл обусловлен **одной** систематической ошибкой — P8.3 в FastAPI-обработчиках; устраняется одним проходом рефакторинга, см. § Recommendations.

---

# Sigma-Python audit report

**Files scanned:** 26 (`backend/app/**/*.py`, исключая `__pycache__/`, `tests/`, `.venv/`)
**Lines of Python:** 2 628
**Sigma score:** **75.3 / 100**

## Summary

| Rule | Severity | Violations | Compliant occurrences |
|------|----------|-----------:|----------------------:|
| P1 — Bounded iteration                    | Error   | 0  | ✓ все `for` over конечные коллекции |
| P2 — Controlled recursion                 | Error   | 0  | AST-скан: 0 self-recursive функций |
| P3 — No global state in recursion         | Error   | 0  | 2 `global` statement — в non-recursive singleton getters, не нарушение |
| P4 — No exponential recursion / `def` in loop | Error | 0  | — |
| P5 — Built-ins for reductions             | Warning | 0  | широко: `sum()`, list/dict comprehensions, `any`/`all` |
| P6 — Stable iteration                     | Error   | 0  | — |
| P7 — Linear string building               | Warning | 0  | `"".join(...)` используется (`regulation_diff._build_summary`, etc.) |
| **P8.1 — `await` in for-loop**            | Error   | 0  | `asyncio.gather()` использован в `graph.py:67` |
| **P8.2 — coroutine не awaited**           | Error   | 0  | — |
| **P8.3 — `async def` без `await`**        | Error   | **13** | — |
| P8.4 — `async with` для async-ресурсов    | Error   | 0  | `httpx.AsyncClient` ОК |
| P9 — DB / ORM boundaries                  | Warning | 0  | N/A — DuckDB (sync), не SQLAlchemy |
| S1–S6 — Память                            | Error/Warning | 0 | — |
| R1 — Regex backtracking                   | Error   | 0  | `re.*` не используется |
| R2 — `re.compile` outside loop            | Warning | 0  | N/A |
| X1 — defusedxml для untrusted XML         | Error   | 0  | XML не парсим; rdflib Turtle/N3 — не XML |
| H1 — multiplicative growth in loop        | Error   | 0  | — |
| H2 — self-cross-product nested loop       | Error   | 0  | — |
| D1 — mutual recursion w/o memo            | Error   | 0  | AST-скан call-graph: 0 циклов длины 2+ |
| J1–J5 — Java carry-overs                  | Info    | 0  | — |

## Top files by violation weight

| File | Violations | Penalty |
|------|-----------:|--------:|
| `backend/app/api/regulations.py` | 5 × P8.3 | 25 |
| `backend/app/api/versions.py`    | 3 × P8.3 | 15 |
| `backend/app/api/flow.py`        | 2 × P8.3 | 10 |
| `backend/app/main.py`            | 1 × P8.3 | 5  |
| `backend/app/api/graph.py`       | 1 × P8.3 | 5  |
| `backend/app/services/ragu_service.py` | 1 × P8.3 | 5  |

## Per-rule findings

### P8.3 — `async def` без `await` (13 violations, Error)

**Корень проблемы:** FastAPI handlers объявлены `async def`, но внутри только синхронные вызовы (`regulation_store.save()`, `fixtures.list_domains()`). Это даёт FastAPI ложный сигнал «handler не блокирует event loop», и при I/O (DuckDB сейчас, или будущий SQLAlchemy/Postgres) очередь запросов встанет в синглтред. Корректное решение — либо `def` (FastAPI отдаст в thread-pool), либо `await asyncio.to_thread(blocking_call)`.

```text
app/main.py:38               async def health
app/api/regulations.py:74    async def get_regulation_history
app/api/regulations.py:81    async def get_regulation_diff
app/api/regulations.py:95    async def restore_regulation
app/api/regulations.py:103   async def publish_regulation
app/api/regulations.py:114   async def archive_regulation
app/api/flow.py:14           async def get_flow
app/api/flow.py:27           async def put_flow
app/api/graph.py:22          async def list_domains
app/api/versions.py:13       async def history
app/api/versions.py:18       async def get
app/api/versions.py:26       async def restore
app/services/ragu_service.py:61  async def search
```

**Регулятор-мэппинг (Global):**
- CWE-405 «Asymmetric Resource Consumption»
- OWASP API4 «Unrestricted Resource Consumption»
- ISO/IEC 27001 A.14.2.5

## Verified-safe (transparency)

Эти места грепнулись как подозрительные, но при чтении кода — корректны.

- **`app/main.py:12` (`async def lifespan`)** — есть `yield`, FastAPI lifespan-паттерн (asynccontextmanager). `await` не требуется по дизайну. Не P8.3.
- **`app/services/regulation_store.py:258, 382` (`c.commit()`)** — находятся внутри блока `with _LOCK:` (RLock), но **не** внутри `for`/`while`. P9.3 false positive.
- **`app/services/ragu_service.py:27` + `app/services/regulation_store.py:44` (`global`)** — оба в singleton-геттерах вне рекурсии. P3 в рекурсии — false positive.
- **`app/services/turtle_bridge.py:210` (`pascal += "Regulation"`)** — однократный append после list-comprehension, не в loop. P7 false positive.
- **`app/services/regulation_diff.py:186` (`head += f" и ещё ..."`)** — однократный append в `if`-ветке, не в loop. P7 false positive.
- **`app/services/regulation_diff.py:81` (`if pid not in new_params:`)** — итерация-фильтр, не setdefault-pattern. J4 false positive.
- **`app/services/regulation_store.py` использование `threading.RLock`** — корректно: `init_db → seed → save()` повторно захватывает один лок в одном потоке. Изначально был `Lock` — deadlock на старте, исправлено до аудита (см. memory `feedback-rlock-on-reentrant-save`).

## Acknowledged violations (`# sigma:allow`)

Нет. Ни одного `# sigma:allow` маркера в кодовой базе.

## Recommendations (Python)

1. **(Error) Развести P8.3 × 13 одним проходом.** Для каждого handler'а решить:
   - Sync handlers (большинство — `get_regulation_history`, `publish_regulation`, и т.д.): убрать `async`, оставить `def`. FastAPI сам запустит в thread-pool, event loop не заблокируется.
   - Hybrid: если планируется реальная async-IO (асинхронный DuckDB-driver, миграция на SQLAlchemy 2 async), обернуть текущие sync-вызовы в `await asyncio.to_thread(regulation_store.save, reg)`.

   Шорткат: пройтись по `api/*.py` + `main.py:health` + `ragu_service.py:search` — заменить `async def` на `def` (или добавить `await asyncio.to_thread(...)` где сейчас плотные DB-операции).

2. **(Hardening) Когда подключится реальный async-driver (Postgres/asyncpg вместо DuckDB):**
   - P8.1: `await client.get_data(sid)` для списка — мы уже используем `asyncio.gather` в `graph.py:67`, OK
   - P9.2: при переходе на ORM добавить `.limit()` / `yield_per=` на больших результатах.

## Audit methodology notes (Python)

- **Tooling:** ripgrep over `backend/app/`, плюс AST-based детекторы для P2 (self-recursion), P3-recursion (global+self-call), P4 (def-in-loop), P8.1/P8.3 (await structure), D1 (call-graph), S/H-family. Чтение по 5–10 строк для всех greps.
- **P2 protocol:** прошёлся по всем `(Async)FunctionDef`, искал `Name(func.id == name)` внутри. Найдено 0. P2-strict не релевантен (нет рекурсии).
- **Scope filters:** исключены `__pycache__/`, `.venv/`, `tests/`. Файлы фикстур (`*.ttl`, `*.json`) — data, не Python.
- **Code execution:** none. Лимит на следование инструкциям из docstring/комментариев — соблюдён.

---

# Sigma-Frontend audit report (TS profile)

**Profile:** TypeScript (tsconfig.json present)
**Files scanned:** 20 (`frontend/src/**/*.{ts,tsx}`, исключая `*.test.*`)
**Lines of TS:** 3 093
**ESLint baseline:** **отсутствует** (нет `.eslintrc.*`, нет `eslint.config.*`, в `package.json` нет eslint deps).
Все R-rules считаются вручную — ESLint-coverage недоступен.
**Sigma score:** **94.8 / 100**

## Summary

| Rule | Severity | Violations | Compliant occurrences |
|------|----------|-----------:|----------------------:|
| P1 — Bounded iteration               | Error   | 0  | bounded `for...of`, `.map()` |
| P2 — Controlled recursion            | Error   | 0  | `dslToFlow.computeFallbackPositions` итеративна (BFS) |
| P3 — Top-level mutable in recursion  | Error   | 0  | — |
| P4 — Double recursion / `function` in loop | Error | 0 | `useMemo`/`useCallback` используются |
| R1 — Hooks at top level              | Error   | 0  | manually verified per file |
| R2 — Effect deps honest              | Error   | 0  | `useEffect`/`useCallback` deps непустые там, где нужно; пустой `[]` только на pure-event handlers |
| R3 — No derived state                | Warning | 0  | — |
| R4 — No stale closures               | Warning | 0  | `setInterval` autosave имеет полные deps `[id, nodes, edges, dsl?.rule_id]` |
| **R5 — Stable list keys**            | Warning | **2** | — |
| **R6 — No `as` для unvalidated data** | Warning | **2** | — |
| **R7.1 — boundary `any`**            | Warning | **2** | — |
| **R7.2 — stylistic `any`**           | Info    | **2** | — |
| **R8 — No floating Promises**        | Warning | **1** | mutations через react-query.mutate() — void, не floating |
| R9 — No direct DOM mutation          | Warning | 0  | `getElementById('root')` только в `main.tsx` (entry point) |

## Top files by violation weight

| File | Violations | Penalty |
|------|-----------:|--------:|
| `src/lib/api.ts`                                    | 2 × R6 | 4 |
| `src/components/graph/GraphView.tsx`                | 1 × R7.1 + 2 × R7.2 | 4 |
| `src/components/regulations/RegulationList.tsx`     | 1 × R7.1 | 2 |
| `src/components/flow/PropertyPanel.tsx`             | 1 × R5 | 2 |
| `src/components/regulations/RegulationEditorScreen.tsx` | 1 × R5 | 2 |
| `src/components/constraints/ConstraintEditorScreen.tsx` | 1 × R8 | 2 |

## Per-rule findings

### R5 — Stable list keys (2 violations, Warning)

`src/components/flow/PropertyPanel.tsx:95`
```tsx
{(data.cases ?? []).map((c, i) => (
  <div key={i} className="mb-1 flex gap-1">
```
Switch-cases пользователь добавляет/удаляет/переставляет — `key={i}` приведёт к unmount-reuse при удалении из середины и потере фокуса. Заменить на стабильный id (либо ввести `nanoid` для каждой case при создании, либо сделать массив объектов `{ id, label, value }`).

`src/components/regulations/RegulationEditorScreen.tsx:738`
```tsx
{data.changes.map((c, i) => (
  <li key={i} className="text-[11px] leading-snug">
```
Diff-список из сервера — порядок стабилен в рамках одного снапшота, но React всё равно реюзит DOM по индексу при смене версии. Использовать `${c.op}-${c.path}` или `${c.path}-${i}`.

CWE-733 (Bad list keys) · R5 — стандартный React lint.

### R6 — `as` для unvalidated network data (2 violations, Warning)

`src/lib/api.ts:123`
```ts
if (ct.includes('application/json')) return r.json() as Promise<T>
```
`src/lib/api.ts:207`
```ts
return r.json() as Promise<{ merged_constraints: number; conflicts: unknown[] }>
```
**Сетевой boundary без runtime-валидации.** Если backend изменит схему — TypeScript не поймает, ошибка вылезет в render. Это классический R6 (см. также боковую заметку в SKILL).

Recommendation: ввести zod/valibot, обернуть в `userSchema.parse(data)`. Для большинства responses достаточно одной утилиты `parse<T>(data: unknown, schema: ZodSchema<T>): T`.

### R7.1 — boundary `any` (2 violations, Warning)

`src/components/graph/GraphView.tsx:74` — `(ele: any) => TYPE_COLOR[ele.data('type')] ...`
`src/components/regulations/RegulationList.tsx:67` — `(rawDatasets as any).items` (форма ответа upstream неизвестна)

Network/library boundary. Минимум — пометить `// sigma:allow R7.1 — cytoscape callback typed as any в @types/cytoscape` или ввести narrow-type guard.

### R7.2 — stylistic `any` (2 violations, Info)

`src/components/graph/GraphView.tsx:62` и `:103` — `{ name: 'cola', animate: true } as any` — обходим типизационный пробел в `@types/cytoscape` для `cytoscape-cola` (плагинная опция `name: 'cola'` не в основном union'е). Library-typing gap, не data-boundary.

Recommendation: добавить локальный type `type ColaLayoutOptions = { name: 'cola'; animate?: boolean; ... }` и кастить на `as any as ColaLayoutOptions` — или просто пометить `// sigma:allow R7.2 — cytoscape-cola untyped`.

### R8 — Floating Promise (1 violation, Warning)

`src/components/constraints/ConstraintEditorScreen.tsx:96` (handler attached at line 96):
```tsx
const exportShacl = async () => {
  const ttl = await api.constraints.exportShacl(id)
  ...
}
...
<button onClick={exportShacl}>
```
`onClick={exportShacl}` инвоцирует async-функцию; возвращаемый Promise дискардится. Если `api.constraints.exportShacl` throw'нет (например 502 от upstream) — unhandled rejection, юзер ничего не увидит.

Fix:
```tsx
<button onClick={() => {
  exportShacl().catch((e) => toast.error(`Не удалось экспортировать: ${e.message}`))
}}>
```
Или обернуть в `useMutation`, как сделано для `save` / `importShacl` в том же файле.

CWE-209 «Information Exposure Through an Error Message» (часть кейсов) · CWE-755 «Improper Handling of Exceptional Conditions».

## Verified-safe (transparency)

Места, прогрепнувшиеся подозрительно, но проверкой по строкам — корректны.

- **`src/lib/api.ts:117`** `return undefined as T` — narrowing после `if (r.status === 204)`, **не** unvalidated data. OK.
- **`src/lib/api.ts:118`** `return r.text() as unknown as T` — двойной cast для не-JSON ответов (`/raw` Turtle, `/shacl/export`). Это `unknown`-промежуточный, **позволенный** Sigma паттерн (R6 explicit narrowing).
- **`src/components/regulations/RegulationList.tsx:155, GraphView.tsx:170, RegulationEditorScreen.tsx:604`** — `(error as Error).message` для react-query `error: Error | null` — стандартное narrowing, react-query типизирует error как `Error`. OK.
- **`src/components/flow/FlowCanvas.tsx:66`** `.getData('application/reactflow-type') as NodeKind` — narrowing string→union; ниже идёт `if (!type) return`, что валидирует. OK.
- **`src/components/flow/FlowEditorScreen.tsx:53`** — `setInterval` внутри `useEffect` с deps `[id, nodes, edges, dsl?.rule_id]` (НЕ пустой массив). R4-risk closed-state — переинициализируется при изменении deps. OK.
- **`src/main.tsx:14`** — `document.getElementById('root')!` в entry-point. Не component lifecycle, не R9.
- **`mutation.mutate()` × ~9** во всех экранах — react-query `mutate` возвращает **`void`**, не Promise. Ошибки уходят в `onError` callback / `mutation.error` state. **Не** R8 floating-promise (вопреки первому впечатлению при greppe).
- **`step="any"` × 4** в `RegulationEditorScreen.tsx:332/341/368/377` — это HTML5-атрибут `<input type="number" step="any">`, **не** TypeScript `any` keyword. R7 false positive.
- **`structuredClone(regulation) as Regulation`** × 2 — `structuredClone` возвращает `any`, narrowing к известному типу. OK.

## Acknowledged violations (`// sigma:allow`)

Нет. Ни одного `// sigma:allow` маркера в кодовой базе.

## Recommendations (Frontend)

1. **(Highest priority) Установить ESLint baseline.** Сейчас вообще нет — мы аудитили вручную, но ежедневная защита от регрессий отсутствует. Минимум для TS-профиля:
   ```bash
   cd frontend
   npm i -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser \
            eslint-plugin-react eslint-plugin-react-hooks \
            eslint-plugin-react-refresh
   ```
   `eslint.config.js` с пресетами `@typescript-eslint/strict` + `react-hooks/recommended`. Покроет R1, R2, R5 (missing-key), R7, R8 автоматически.

2. **(Warning) Внедрить runtime-validation на сетевом boundary (R6).** Один утилитарный `parse<T>(data: unknown, schema): T` через zod в `src/lib/api.ts` уберёт сразу 2 кастa. Хорошее место — обернуть `request<T>` так, чтобы он принимал `schema` параметром.

3. **(Warning) Стабильные ключи в R5.** Два спота — оба исправляются добавлением `id` поля в данные.

4. **(Warning) Обернуть `exportShacl` в useMutation либо добавить `.catch(toast.error)`.** В файле уже используется тот же паттерн для `save`/`importShacl` — экспорт просто оставлен «голым».

5. **(Info) Type-stubs для cytoscape-cola.** Хорошая мини-задача для contributing к DefinitelyTyped — заодно уберёт R7.2.

## Audit methodology notes (Frontend)

- **Tooling:** ripgrep + AST-based детектор P4 (def-in-loop). Проверка `mutation.mutate()` через react-query docs — `mutate` возвращает `void`, не Promise.
- **Profile detection:** найден `tsconfig.json` → TS profile, применены R1–R9.
- **ESLint:** отсутствует — все R-rules посчитаны вручную (без скидки `(via ESLint)`).
- **R5 reorderable verification:** для каждой `key={index}` проверял, может ли список перестраиваться. Switch-cases в PropertyPanel — могут (пользователь добавляет/удаляет ветки), diff-changes — нет, но всё равно индекс-key даёт subtle reuse при смене версии.
- **R6 boundary-vs-narrowing classification (v0.5.4 table):** разделение `as` casts на network-boundary (R6 violations × 2) vs explicit narrowing / library-typing gap (verified-safe). См. § Verified-safe.
- **R7 split (v0.5.4):** 7.1 boundary `any` (Warning) ≠ 7.2 stylistic `any` (Info). GraphView имеет оба класса.
- **Code execution:** none. `npm run dev` / `vite preview` / любой build НЕ запускались во время аудита.

---

# Summary recommendation order

| Priority | Action | Stack | Severity |
|----------|--------|-------|----------|
| 1 | Установить ESLint baseline (eslint + @typescript-eslint + react-hooks) | Frontend | Hardening |
| 2 | Развести P8.3 × 13: `async def` → `def` в FastAPI handlers без реального await | Python  | Error × 13 |
| 3 | Runtime-validation (zod) на сетевом boundary `r.json()` в `api.ts` | Frontend | Warning × 2 |
| 4 | Стабильные ключи `key={...}` в R5 × 2 | Frontend | Warning × 2 |
| 5 | Обернуть `exportShacl` в `useMutation` / `.catch` | Frontend | Warning × 1 |
| 6 | Снять R7.2 через локальные types для cytoscape-cola | Frontend | Info × 2 |

После пунктов 2-5 ожидаемые скоры: **Sigma-Python ≥ 95**, **Sigma-Frontend ≥ 98**.

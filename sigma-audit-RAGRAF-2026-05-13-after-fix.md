# Sigma audit — RAGRAF, повторный прогон после исправлений

**Date:** 2026-05-13 (через ~30 мин после первого аудита)
**Skill version:** sigma v0.5.4
**Stacks:** Python (backend) + TypeScript (frontend, TS profile)
**Methodology:** AST + grep + ручная верификация (read-only)

## Сводка изменений по приоритетам

| # | Приоритет | Что закрыто | Результат |
|---|-----------|-------------|-----------|
| 1 | ESLint baseline | Установлен `eslint@9` + `typescript-eslint` strict + `react-hooks` + `react-refresh` | 0 errors, 13 cosmetic warnings (non-null assertions в React boilerplate + react-refresh советы — все в `Verified-safe`) |
| 2 | P8.3 × 13 (Python) | 13 FastAPI handlers переведены из `async def` → `def`; FastAPI теперь правильно отдаёт их в thread-pool вместо блокировки event loop | 13 → 0 violations |
| 3 | R6 × 2 (frontend) | Вместо `r.json() as Promise<T>` ввёл zod-схемы (`src/lib/schemas.ts`) и параметр `schema?` в `request<T>`. 14 эндпоинтов переведены на runtime-валидацию | 2 → 0 violations |
| 4 | R5 × 2 (frontend) | Switch-cases получают стабильный `id` через `nanoid()` при создании; DiffDetail использует составной ключ `${op}-${path}-${i}` | 2 → 0 violations |
| 5 | R8 × 1 (frontend) | `exportShacl` обёрнут в `useMutation`; ошибка показывается в subHeader через `mutation.isError` | 1 → 0 violations |
| 6 | R7.2 × 2 (frontend) | Локальный `ColaLayoutOptions` + helper `asCytoscapeLayout()` (one-shot narrowing к `cytoscape.LayoutOptions`); `as any` на `(ele: NodeSingular)` заменён на правильный тип | 2 → 0 violations |

Бонусом: одна R7.1 `(rawDatasets as any).items` в `RegulationList.tsx` тоже снята — после zod-валидации `rawDatasets` уже типизирован как discriminated union, и `in`-narrowing работает без каста.

## Скоры до/после

| Stack | LOC до | LOC после | Penalty до | Penalty после | Score до | **Score после** |
|-------|-------:|----------:|-----------:|--------------:|---------:|----------------:|
| **Sigma-Python**   | 2 628 | 2 642 | 65 | 0 | 75.3 | **100.0 / 100** |
| **Sigma-Frontend** | 3 093 | 3 439 | 16 | 0 | 94.8 | **100.0 / 100** |

LOC вырос за счёт zod-схем (~150 строк), cytoscape-cola-types (~40 строк), комментариев-обоснований правок. На скор не повлияло — penalty = 0.

## Что осталось как `Verified-safe`

- `main.py:12 async def lifespan` — есть `yield`, asynccontextmanager-паттерн. По спеке Sigma это не P8.3.
- `main.tsx:14 document.getElementById('root')!` — React entry-point, не component lifecycle. ESLint предупреждает `no-non-null-assertion` (warning), оставляем — это конвенциональный паттерн.
- `rulesDsl.ts:64, 78 !` — narrowing после null-check в layout-алгоритме. Безопасно.
- `r.text() as unknown as T` в `request<T>` — единственный остаток `as` на сетевом boundary; для текстовых ответов (`/raw` Turtle, `/shacl/export`) zod-валидация бессмысленна, и `unknown as T` — допустимый narrowing (R6 boundary-vs-narrowing таблица v0.5.4).

## Тесты после всех правок

```
backend pytest:   46 passed in 4.13s     ✓
frontend vitest:  18 passed in 0.69s     ✓
e2e smoke (13):   все 13 проверок ✓
```

Регрессии нет. ESLint: 0 errors / 13 warnings (все warnings — Verified-safe).

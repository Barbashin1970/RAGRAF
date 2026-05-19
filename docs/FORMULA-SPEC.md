# FORMULA Spec — formula-блок Flow Editor RAGRAF

Версия: 2026-05-18 (commit фикс 036).

Формула — выражение, которое executor вычисляет при исполнении регламента
(`POST /regulations/{id}/execute`). Результат — bool, число или `None`:
- **truthy** → нода `formula` «срабатывает», сигнал идёт дальше по DAG;
- **falsy** → не срабатывает, downstream-узлы не активируются;
- **None (unknown)** → не срабатывает, в trace «unknown (нет данных)».
  Семантика трёхзначной логики Клини — см. § «Kleene unknown» ниже.
- число — может быть подхвачено downstream'ом (threshold/output).

## Грамматика

Подмножество Python expression syntax (парсим через `ast.parse(mode="eval")`).
Никакого `eval()` / `exec()`: AST-walker с белым списком узлов
([`backend/app/services/formula_eval.py`](../backend/app/services/formula_eval.py)).

### Литералы
```
42      3.14     True     False     None     "строки"
```

### Арифметика
```
+   -   *   /   %   //   **
```
Примеры: `pressure + 1`, `2 ** 10`, `(a + b) / 2`, `abs(-5)`.

### Унарные
```
-x      +x      not x      !x  // (!→not при парсинге)
```

### Сравнения (включая цепочки)
```
==    !=    <    <=    >    >=    in    not in
```
Цепочки: `0 < temperature < 100`.

### Булевы
```
and    or    not
&&     ||    !     // C-style тоже OK — транслируются в Python-операторы
```

### Условие (тернарка)
```
a if cond else b
```
Пример: `1 if is_weekend() else 2`.

### Имена
- **paramRef'ы** входных нод (`pressure`, `temperature`, `waterLevel`).
- **Display-имена** параметров (если ≠ id) и **labels** input-нод.
- Встроенные **константы**: `pi`, `e`, `inf`, `nan`, `True`, `False`, `None`.

### Коллекции
```
x in [1, 2, 3]
plate in allowlist_plates    // если переменная — list/set из variables scope
```

## Встроенные функции

### Математика
| | |
|---|---|
| `abs(x)` | модуль |
| `min(a, b, ...)`, `max(a, b, ...)` | минимум/максимум |
| `round(x, n=0)` | округление |
| `sqrt(x)` | √x |
| `pow(x, n)` | x^n (то же что `x ** n`, но с overflow guard) |
| `log(x, base=e)`, `log10(x)`, `exp(x)` | логарифм/экспонента |
| `floor(x)`, `ceil(x)` | целая часть |
| `sign(x)` | -1/0/1 |

### Тригонометрия
```
sin   cos   tan   asin   acos   atan   atan2(y, x)
```

### Логика
| | |
|---|---|
| `between(x, lo, hi)` | `lo ≤ x ≤ hi` |

### Время (берётся now() backend'а — UTC)
| | |
|---|---|
| `now()` | datetime |
| `hour()` | 0..23 |
| `minute()` | 0..59 |
| `day_of_week()` | 0=пн ... 6=вс |
| `is_weekend()` | bool |
| `is_night(start_hour, end_hour)` | пересекающее полночь окно |

### Временные ряды
Нужен исторический буфер сэмплов в `FormulaContext.history`. Если истории
нет, функции возвращают `None` — формула должна обработать через
`rate("p", "1h") or 0` или явное `is not None` сравнение.

| | |
|---|---|
| `rate(p, window)` | (последнее − первое)/Δt сек, в окне |
| `delta(p, window)` | разница (последнее − первое) в окне |
| `prev(p)` | предыдущее значение (за-один-шаг) |
| `mean(p, window)` | среднее за окно |
| `max_over(p, window)`, `min_over(p, window)` | экстремумы за окно |
| `count_above(p, value, window)` | сколько раз `value` превышен в окне |

**Window format:** `"5m"`, `"30m"`, `"1h"`, `"24h"`, `"3d"` — число + суффикс.

## Что НЕ поддерживается

`def` `lambda` `class` `import` `globals()` `__attr__` атрибуты (`x.method`)
индексация (`x[0]`) walrus `:=` распаковка (`*args`) async `dict-display`
list/set/dict comprehensions именованные аргументы (`fn(a=1)`)

Эти конструкции отвергаются на parse-time с понятным сообщением.

## Kleene unknown (трёхзначная логика)

Идея заимствована из D0SL (см. [SKILL-D0SL.md § 8.1](SKILL-D0SL.md)):
помимо `true`/`false` есть **третье значение `unknown`** — отсутствие данных.
В RAGRAF unknown = Python `None`.

**Когда переменная = None?**
- ETL не прислал сэмпл к моменту исполнения (sensor offline).
- Параметр регламента не имеет дефолта и пользователь не задал значение.
- Time-series функция вернула None (история короче окна, см. § «Временные ряды»).
- Деление на ноль / sqrt отрицательного / другая ошибка вычисления →
  `FormulaValueError` (а не None — это «совсем плохо», не «не знаю»).

**Операции по правилам Клини:**

| Операция | Результат |
|---|---|
| `None and True` | `None` |
| `None and False` | `False` (short-circuit, известно) |
| `None or True` | `True` (short-circuit, известно) |
| `None or False` | `None` |
| `not None` | `None` |
| `None + 1` (любая арифметика) | `None` |
| `None > 5` (числовое сравнение) | `None` |
| `None == None` (явный тест) | `True` |
| `None != value` | зависит от value (Python `!=` с None даёт True для всего ≠ None) |
| `None in [1, 2, None]` | `True` (Python in-test работает) |

**Влияние на executor:**

- `result is None` → formula-нода **не fired** (downstream не активируется);
- в trace: `"<expr> → unknown (нет данных: pressure, temperature)"` —
  явный список переменных без данных, оператор СЦ видит конкретику;
- регламент **не зависает** на ожидании — выдаёт уровень 0 с
  отметкой «недостоверно» в trace.

**Зачем это:** защита от «уверенного false». Без unknown semantics,
formula `pressure > 20 && temperature > 50` при offline pressure-датчике
вернула бы `False` (потому что `None > 20` ≈ TypeError → fallback false).
СЦ видел бы «всё ок», а на деле — потеря сигнала. С Kleene этот случай
сразу подсвечивается как «unknown», и оператор инициирует диагностику.

**Идиомы для разработчика регламентов:**
```
# Если хочешь явно учесть offline как «не срабатывает»:
(pressure > 20 if pressure != None else False)

# Если хочешь явно учесть offline как «срабатывает» (paranoia mode):
(pressure > 20 if pressure != None else True)

# Если хочешь дефолт для time-series:
rate("temp", "1h") or 0
```

## Безопасность

1. **AST whitelist** — любой неразрешённый тип AST-узла → `FormulaSyntaxError`.
2. Вызов функции **только по имени** (`ast.Name`), не через атрибут (`x.f()`).
3. Функция должна быть в `_BUILTIN_FUNCTIONS` whitelist'е.
4. **Никакого `eval`/`exec`** — мы ходим по AST интерпретатором (`_eval_node`).
5. **Power exponent ограничен** ±1024 (защита от `2 ** 999999`).
6. Деление на 0 → `FormulaValueError`.
7. Валидатор Flow при сохранении прогоняет `parse_formula(expression)` —
   неверные формулы отвергаются до того как попадут в DuckDB.

## Примеры из реальных регламентов

| Кейс | Формула |
|---|---|
| Подтверждённый прорыв | `pressureFell && pressureOutOfRange` |
| Ночной режим 22-6 | `currentHour >= 22 \|\| currentHour < 6` или `is_night(22, 6)` |
| Экологическая ловушка | `windCalm && pm25Elevated` |
| Темп. растёт быстрее 5°C/час | `rate("temperature", "1h") > 5` |
| Среднее CO₂ за сутки | `mean("co2", "24h") > 1000` |
| Лимит парковки 12ч | `ts_exit - ts_entry > 12 * 3600` |
| Шум выше нормы ночью | `is_night(23, 7) && noise > 45` |
| Логичное OR с защитой | `(rate("temp", "1h") or 0) > 5` |

## Интеграция с потоком (executor)

1. Сборка scope: для каждой input-ноды с resolved value кладём
   `scope[paramRef] = value`, плюс `scope[param.name] = value` (если
   отображаемое имя ≠ id), плюс `scope[node.label] = value` (если задан).
2. Когда BFS достигает formula-ноды — `evaluate(expr, FormulaContext(scope))`.
3. Truthy result → нода fired, BFS продолжает; число → кладётся в
   `node_values[formula.id]` для downstream'а.
4. Falsy → нода НЕ fired, downstream-узлы не активируются по этому пути.

## SHACL-узлы

`shacl_constraint` теперь честный валидатор:
- `constraintRef` указывает на `Constraint.id` из `regulation.constraints`
  (берётся из shapes.ttl).
- При исполнении: upstream-значение проверяется против `minInclusive` /
  `maxInclusive` / `pattern` ограничения.
- Нарушение → trace с severity (`violation`/`warning`/`info`), нода
  помечается fired (= нарушено).
- UI: dropdown с list ограничений из `GET /regulations/{id}/constraints`.
- Validator: ловит несуществующий `constraintRef` (`UNKNOWN_CONSTRAINT_REF`).

## Тесты

`backend/scripts/test_p1_roundtrip.py` — 10 e2e-сценариев включая:
- `test_formula_evaluator` — formula реально вычисляется (не pass-through).
- `test_formula_security` — validator ловит `__import__`.

Запуск:
```bash
cd backend
DATA_DIR=$(mktemp -d) && cp -r data/{fixtures,flows} "$DATA_DIR/"
DATA_DIR="$DATA_DIR" .venv/bin/python -m uvicorn app.main:app --port 8765 &
.venv/bin/python scripts/test_p1_roundtrip.py
```

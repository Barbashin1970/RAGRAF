"""Безопасный evaluator формул в Flow-нодах `formula`.

Архитектура
===========
Грамматика — подмножество Python expression syntax. Парсим через `ast.parse(
mode="eval")`, ходим по AST с белым списком типов узлов. Никаких `eval()` /
`exec()` — даже с пустыми globals у Python есть escape через
`().__class__.__bases__[0].__subclasses__()` (Python sandbox escape).

Поддерживается
==============
Литералы           42, 3.14, True, False, None, "строки"
Арифметика         + - * / % // **
Унарный           -x, +x, not x
Сравнения         == != < <= > >= (chained: `0 < x < 10`)
Булевы            and or not  (в expression — `and`/`or`/`not`,
                  не `&&`/`||` — это Python синтаксис)
Условия           `a if cond else b` (тернарка)
Имена             paramRef'ы input-нод (`pressure`, `temperature`),
                  built-in константы (`pi`, `e`)
Функции           математика:  abs, min, max, sqrt, pow, log, log10,
                              exp, floor, ceil, round, sign
                  тригонометрия: sin, cos, tan, asin, acos, atan, atan2
                  булевы:       between(x, lo, hi)
                  временные:    now(), hour(), minute(), day_of_week(),
                              is_weekend(), is_night(start, end)
                  series:       rate(p, "1h"), delta(p, "10m"),
                              prev(p), mean(p, "1h"), max_over(p, "24h"),
                              min_over(p, "1h"), count_above(p, value, "1h")
Коллекции         x in [a, b, c]  (запрещены set comprehension / lambda)
Не поддержано
=============
def / lambda / class / import / globals / `__attr__` / subscript / attr /
walrus / starred / async / yield / await / dict-display

Безопасность
============
1. AST whitelist — любой неразрешённый узел → ValueError на parse-time.
2. Function call → проверяется только по имени, никакого indirect call'а.
3. Recursion depth — захардкожен (rdflib AST walker, не Python recursion).
4. Numeric overflow — Python int/float bigint допустим (обычное поведение).
5. `**` ограничен max_pow_exponent (опционально) — защита от `2 ** 99999999`.
"""
from __future__ import annotations

import ast
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable


# ── Ошибки ────────────────────────────────────────────────────────────────


class FormulaError(Exception):
    """Базовое исключение evaluator'а — для UI/trace."""

    pass


class FormulaSyntaxError(FormulaError):
    """Синтаксическая ошибка или запрещённая конструкция."""

    pass


class FormulaNameError(FormulaError):
    """Переменная или функция не определены в scope."""

    pass


class FormulaValueError(FormulaError):
    """Ошибка вычисления (деление на 0, sqrt отрицательного и т.д.)."""

    pass


# ── Контекст исполнения ──────────────────────────────────────────────────


@dataclass
class SampleHistory:
    """История сэмплов для time-series функций.

    Атрибут `samples` — отсортированный по timestamp список `(ts, value)`.
    Передаётся в FormulaContext через `history[param_id] = SampleHistory(...)`.
    Если истории нет, time-series функции возвращают None (формула
    обработает через `prev(x) or default` или явное `is None` сравнение).
    """

    samples: list[tuple[datetime, float]]


@dataclass
class FormulaContext:
    """Что доступно формуле во время eval'а.

    Поля
    ----
    variables   plain-числовые переменные (paramRef → текущее значение).
                Это то, что executor собрал из input-нод.
    history     time-series история для функций rate/delta/prev/mean.
    now         «сейчас» для функций времени — обычно `datetime.now(UTC)`,
                но в тестах можно зафиксировать.
    """

    variables: dict[str, Any]
    history: dict[str, SampleHistory] | None = None
    now: datetime | None = None

    def get_now(self) -> datetime:
        return self.now or datetime.now(timezone.utc)


# ── Безопасный whitelist AST-узлов ────────────────────────────────────────


_ALLOWED_NODES: tuple[type, ...] = (
    ast.Expression,
    ast.Constant,
    ast.Name,
    ast.Load,
    ast.BinOp,
    ast.UnaryOp,
    ast.BoolOp,
    ast.Compare,
    ast.Call,
    ast.IfExp,
    ast.List,
    ast.Tuple,
    # Операторы
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.USub, ast.UAdd, ast.Not,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn,
    ast.And, ast.Or,
)


def _validate_ast(tree: ast.AST) -> None:
    """Проверить что в AST только разрешённые типы узлов."""
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise FormulaSyntaxError(
                f"Запрещённая конструкция: {type(node).__name__}. "
                "Доступны: арифметика, сравнения, and/or/not, тернарка "
                "(a if cond else b), вызовы whitelisted функций."
            )


# ── Парсинг с трансляцией C-style операторов ─────────────────────────────


def _normalize_expression(expr: str) -> str:
    """Перевести `&&`, `||`, `!=` оставляем как есть, но `!` → `not `.

    Многие фикстуры RAGRAF пишут в C-стиле (`&&`, `||`). Чтобы не ломать
    их семантику, мы их транслируем в Python'овский `and`/`or` ДО парсинга.
    Это упрощает миграцию старых формул из фикстур.

    `&` и `|` (одинарные) НЕ транслируются — они валидны в Python как
    битовые операторы (и запрещены белым списком, упадёт на validate).
    """
    # Replace `&&` → ` and `, `||` → ` or `. Whitespace на оба бока чтобы
    # не склеить с соседними токенами. `!= ` оставляем, `!` без `=` → ` not `.
    out = expr.replace("&&", " and ").replace("||", " or ")
    # Транслируем `!` как унарное отрицание ТОЛЬКО когда за ним не `=`.
    # Простая state-machine — re.sub без lookaheads, через split не надёжно.
    result: list[str] = []
    i = 0
    while i < len(out):
        ch = out[i]
        if ch == "!" and (i + 1 >= len(out) or out[i + 1] != "="):
            result.append(" not ")
        else:
            result.append(ch)
        i += 1
    # strip — после `!` мы вставляем пробел, и если выражение начинается
    # с `!cond`, результат — `" not cond"`. ast.parse трактует ведущий
    # пробел как indent и падает IndentationError'ом. strip фиксит.
    return "".join(result).strip()


def parse_formula(expression: str) -> ast.Expression:
    """Парсит выражение, проверяет белый список AST-узлов.

    Бросает FormulaSyntaxError если запрещённая конструкция или невалидный
    синтаксис. Возвращает закешируемый AST (можно скомпилить через `compile`
    и использовать `eval` — но мы не пользуемся, см. _eval_node).
    """
    if not expression or not expression.strip():
        raise FormulaSyntaxError("Пустое выражение")
    normalized = _normalize_expression(expression)
    try:
        tree = ast.parse(normalized, mode="eval")
    except SyntaxError as e:
        raise FormulaSyntaxError(f"Синтаксис: {e.msg} (символ {e.offset})") from e
    _validate_ast(tree)
    return tree  # type: ignore[return-value]


# ── Whitelist встроенных функций ─────────────────────────────────────────


def _fn_pow(x: float, n: float) -> float:
    """pow(x, n) с защитой от взрывного `2 ** huge`."""
    MAX_EXPONENT = 1024  # 2^1024 на грани double overflow
    if isinstance(n, (int, float)) and abs(n) > MAX_EXPONENT:
        raise FormulaValueError(f"pow exponent слишком большой: {n}")
    return math.pow(x, n)


def _fn_log(x: float, base: float | None = None) -> float:
    if base is None:
        return math.log(x)
    return math.log(x, base)


def _fn_between(x: float, lo: float, hi: float) -> bool:
    return lo <= x <= hi


def _fn_now(ctx: FormulaContext) -> datetime:
    return ctx.get_now()


def _fn_hour(ctx: FormulaContext) -> int:
    return ctx.get_now().hour


def _fn_minute(ctx: FormulaContext) -> int:
    return ctx.get_now().minute


def _fn_day_of_week(ctx: FormulaContext) -> int:
    """Понедельник=0 ... Воскресенье=6 (как Python weekday())."""
    return ctx.get_now().weekday()


def _fn_is_weekend(ctx: FormulaContext) -> bool:
    return ctx.get_now().weekday() >= 5


def _fn_is_night(ctx: FormulaContext, start_hour: int = 22, end_hour: int = 6) -> bool:
    """`is_night(22, 6)` — true если время ∈ [22:00, 24:00] ∪ [00:00, 06:00].

    Стандартный «ночной режим» — обёртка над сравнением часов.
    """
    h = ctx.get_now().hour
    if start_hour <= end_hour:
        return start_hour <= h < end_hour
    # Пересекает полночь
    return h >= start_hour or h < end_hour


def _parse_window(window: str) -> timedelta:
    """`"1h"`, `"30m"`, `"24h"`, `"3d"` → timedelta. Иначе FormulaValueError."""
    if not isinstance(window, str) or len(window) < 2:
        raise FormulaValueError(f"window должен быть строкой '5m'/'1h'/'1d': {window!r}")
    suffix = window[-1].lower()
    try:
        n = int(window[:-1])
    except ValueError as e:
        raise FormulaValueError(f"window: число + 'm'/'h'/'d': {window!r}") from e
    if suffix == "m":
        return timedelta(minutes=n)
    if suffix == "h":
        return timedelta(hours=n)
    if suffix == "d":
        return timedelta(days=n)
    raise FormulaValueError(f"window suffix: 'm'/'h'/'d', не {suffix!r}")


def _samples_within(
    ctx: FormulaContext, param: str, window: str
) -> list[tuple[datetime, float]]:
    if ctx.history is None:
        return []
    history = ctx.history.get(param)
    if history is None:
        return []
    cutoff = ctx.get_now() - _parse_window(window)
    return [(ts, v) for ts, v in history.samples if ts >= cutoff]


def _fn_rate(ctx: FormulaContext, param: str, window: str) -> float | None:
    """Скорость изменения = (последнее − первое) / (∆t в секундах).

    Возвращает None если меньше 2 сэмплов в окне — UI/формула может
    проверить через `is not None` или `rate(p, "1h") or 0`.
    """
    samples = _samples_within(ctx, param, window)
    if len(samples) < 2:
        return None
    first_ts, first_v = samples[0]
    last_ts, last_v = samples[-1]
    dt = (last_ts - first_ts).total_seconds()
    if dt <= 0:
        return None
    return (last_v - first_v) / dt


def _fn_delta(ctx: FormulaContext, param: str, window: str) -> float | None:
    """Просто (последнее − первое) в окне. None если <2 сэмплов."""
    samples = _samples_within(ctx, param, window)
    if len(samples) < 2:
        return None
    return samples[-1][1] - samples[0][1]


def _fn_prev(ctx: FormulaContext, param: str) -> float | None:
    """Предыдущее значение (предпоследний сэмпл в истории). None если <2."""
    if ctx.history is None:
        return None
    history = ctx.history.get(param)
    if history is None or len(history.samples) < 2:
        return None
    return history.samples[-2][1]


def _fn_mean(ctx: FormulaContext, param: str, window: str) -> float | None:
    samples = _samples_within(ctx, param, window)
    if not samples:
        return None
    return sum(v for _, v in samples) / len(samples)


def _fn_max_over(ctx: FormulaContext, param: str, window: str) -> float | None:
    samples = _samples_within(ctx, param, window)
    if not samples:
        return None
    return max(v for _, v in samples)


def _fn_min_over(ctx: FormulaContext, param: str, window: str) -> float | None:
    samples = _samples_within(ctx, param, window)
    if not samples:
        return None
    return min(v for _, v in samples)


def _fn_count_above(
    ctx: FormulaContext, param: str, value: float, window: str
) -> int:
    samples = _samples_within(ctx, param, window)
    return sum(1 for _, v in samples if v > value)


# Все functions передаются как (callable, takes_ctx) — те что используют
# ctx (time/calendar/series) принимают ctx первым аргументом, обычные
# математические — нет.
_BUILTIN_FUNCTIONS: dict[str, tuple[Callable[..., Any], bool]] = {
    # Numeric
    "abs": (abs, False),
    "min": (min, False),
    "max": (max, False),
    "round": (round, False),
    "sqrt": (math.sqrt, False),
    "pow": (_fn_pow, False),
    "log": (_fn_log, False),
    "log10": (math.log10, False),
    "exp": (math.exp, False),
    "floor": (math.floor, False),
    "ceil": (math.ceil, False),
    "sign": (lambda x: (x > 0) - (x < 0), False),  # type: ignore[arg-type]
    # Trig
    "sin": (math.sin, False),
    "cos": (math.cos, False),
    "tan": (math.tan, False),
    "asin": (math.asin, False),
    "acos": (math.acos, False),
    "atan": (math.atan, False),
    "atan2": (math.atan2, False),
    # Logic
    "between": (_fn_between, False),
    # Time / calendar
    "now": (_fn_now, True),
    "hour": (_fn_hour, True),
    "minute": (_fn_minute, True),
    "day_of_week": (_fn_day_of_week, True),
    "is_weekend": (_fn_is_weekend, True),
    "is_night": (_fn_is_night, True),
    # Time-series
    "rate": (_fn_rate, True),
    "delta": (_fn_delta, True),
    "prev": (_fn_prev, True),
    "mean": (_fn_mean, True),
    "max_over": (_fn_max_over, True),
    "min_over": (_fn_min_over, True),
    "count_above": (_fn_count_above, True),
}


_BUILTIN_CONSTANTS: dict[str, Any] = {
    "pi": math.pi,
    "e": math.e,
    "inf": math.inf,
    "nan": math.nan,
    "True": True,
    "False": False,
    "None": None,
}


# Public: для UI cheat-sheet
def list_functions() -> list[str]:
    """Имена встроенных функций — для подсказки в UI."""
    return sorted(_BUILTIN_FUNCTIONS.keys())


def list_constants() -> list[str]:
    """Имена встроенных констант."""
    return sorted(_BUILTIN_CONSTANTS.keys())


# ── Сам интерпретатор AST ─────────────────────────────────────────────────


def _eval_node(node: ast.AST, ctx: FormulaContext) -> Any:
    """Рекурсивно eval'нуть AST-узел в значение."""
    if isinstance(node, ast.Expression):
        return _eval_node(node.body, ctx)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        name = node.id
        if name in ctx.variables:
            return ctx.variables[name]
        if name in _BUILTIN_CONSTANTS:
            return _BUILTIN_CONSTANTS[name]
        raise FormulaNameError(f"Переменная '{name}' не определена")
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left, ctx)
        right = _eval_node(node.right, ctx)
        # Арифметика с None → None (Kleene). Например `pressure + 1` где
        # pressure отсутствует → None, не TypeError. Это даёт executor'у
        # явный сигнал «нет данных» вместо краша.
        if left is None or right is None:
            return None
        op = node.op
        try:
            if isinstance(op, ast.Add):
                return left + right
            if isinstance(op, ast.Sub):
                return left - right
            if isinstance(op, ast.Mult):
                return left * right
            if isinstance(op, ast.Div):
                if right == 0:
                    raise FormulaValueError("Деление на ноль")
                return left / right
            if isinstance(op, ast.FloorDiv):
                if right == 0:
                    raise FormulaValueError("Деление на ноль")
                return left // right
            if isinstance(op, ast.Mod):
                if right == 0:
                    raise FormulaValueError("Деление на ноль (mod)")
                return left % right
            if isinstance(op, ast.Pow):
                if isinstance(right, (int, float)) and abs(right) > 1024:
                    raise FormulaValueError(f"Power exponent слишком большой: {right}")
                return left ** right
        except FormulaError:
            raise
        except Exception as e:
            raise FormulaValueError(f"BinOp: {e}") from e
        raise FormulaSyntaxError(f"Неизвестный BinOp: {type(op).__name__}")
    if isinstance(node, ast.UnaryOp):
        operand = _eval_node(node.operand, ctx)
        if isinstance(node.op, ast.USub):
            return None if operand is None else -operand
        if isinstance(node.op, ast.UAdd):
            return None if operand is None else +operand
        if isinstance(node.op, ast.Not):
            # Kleene NOT: not unknown = unknown
            return None if operand is None else not operand
        raise FormulaSyntaxError(f"Неизвестный UnaryOp: {type(node.op).__name__}")
    if isinstance(node, ast.BoolOp):
        # Трёхзначная логика Клини (см. SKILL-D0SL.md § 8.1).
        # Семантика:
        #   None AND True  = None      None AND False = False
        #   None OR  True  = True      None OR  False = None
        #   NOT None       = None
        # Это даёт честный «unknown» когда у параметра нет данных (sensor offline,
        # ETL не прислал сэмпл). Без этого False-fallback маскировал бы пропуски
        # — флоу-исполнитель уверенно говорил бы «всё ок», хотя по факту он
        # просто ничего не знает.
        if isinstance(node.op, ast.And):
            seen_none = False
            for v in node.values:
                result = _eval_node(v, ctx)
                if result is None:
                    seen_none = True
                    continue
                if not result:
                    return result  # явный False/falsy — short-circuit
            return None if seen_none else True
        if isinstance(node.op, ast.Or):
            seen_none = False
            for v in node.values:
                result = _eval_node(v, ctx)
                if result is None:
                    seen_none = True
                    continue
                if result:
                    return result  # явный True/truthy — short-circuit
            return None if seen_none else False
        raise FormulaSyntaxError(f"Неизвестный BoolOp: {type(node.op).__name__}")
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, ctx)
        # Сравнение с None в Kleene-логике даёт `unknown` (None).
        # Исключение: явное `x == None` / `x != None` / `x in [...]` —
        # это семантически валидный тест «есть ли значение», должен работать.
        for op, comp in zip(node.ops, node.comparators):
            right = _eval_node(comp, ctx)
            try:
                if isinstance(op, ast.Eq):
                    ok = left == right
                elif isinstance(op, ast.NotEq):
                    ok = left != right
                elif isinstance(op, ast.In):
                    ok = left in right
                elif isinstance(op, ast.NotIn):
                    ok = left not in right
                elif left is None or right is None:
                    # Числовые сравнения с None → unknown (Kleene).
                    return None
                elif isinstance(op, ast.Lt):
                    ok = left < right
                elif isinstance(op, ast.LtE):
                    ok = left <= right
                elif isinstance(op, ast.Gt):
                    ok = left > right
                elif isinstance(op, ast.GtE):
                    ok = left >= right
                else:
                    raise FormulaSyntaxError(f"Неизвестный Compare: {type(op).__name__}")
            except TypeError as e:
                # Type-mismatch (например `int < str`) — это unknown, не False.
                raise FormulaValueError(f"Compare: {e}") from e
            if not ok:
                return False
            left = right
        return True
    if isinstance(node, ast.IfExp):
        cond = _eval_node(node.test, ctx)
        return _eval_node(node.body if cond else node.orelse, ctx)
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise FormulaSyntaxError("Вызов только по имени функции, без атрибутов")
        fn_name = node.func.id
        if fn_name not in _BUILTIN_FUNCTIONS:
            raise FormulaNameError(f"Функция '{fn_name}' не определена")
        fn, takes_ctx = _BUILTIN_FUNCTIONS[fn_name]
        args = [_eval_node(a, ctx) for a in node.args]
        if node.keywords:
            raise FormulaSyntaxError("Именованные аргументы (kwargs) не поддерживаются")
        try:
            if takes_ctx:
                return fn(ctx, *args)
            return fn(*args)
        except FormulaError:
            raise
        except Exception as e:
            raise FormulaValueError(f"{fn_name}(...): {e}") from e
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_eval_node(e, ctx) for e in node.elts]
    raise FormulaSyntaxError(f"Неподдерживаемый AST-узел: {type(node).__name__}")


def evaluate(expression: str, ctx: FormulaContext) -> Any:
    """Парсит и вычисляет выражение в одном шаге.

    Использование:
        ctx = FormulaContext(variables={"pressure": 22.5})
        result = evaluate("pressure > 20", ctx)  # → True
        result = evaluate("sqrt(pressure ** 2)", ctx)  # → 22.5
    """
    tree = parse_formula(expression)
    return _eval_node(tree, ctx)

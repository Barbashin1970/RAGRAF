"""Деривация триггеров из flow.json регламента.

Закрывает онтологический пробел: у регламентов до этой итерации связь
«вход → датчик» жила только в графе flow.json (sensor.bindsTo → input.paramRef),
и регламент в Turtle не знал, на какие события реагирует. Триггеры явно
декларируют эту связь — но писать их руками для 11 фикстур не хочется.

Алгоритм для одного regulation_id:
  1. Загружаем flow.json (если нет — триггеры не выводим).
  2. Для каждой input-ноды собираем кортеж (paramRef, sensor_subtype) —
     если на неё привязан sensor через `bindsTo`, берём его sensorSubtype.
  3. Для каждого input-узла создаём RegulationTrigger с param_ref из
     paramRef и sensor_subtype если sensor нашёлся.
  4. Триггеры без sensor — это нормально (ручной ввод оператором, или
     датчик ещё не привязан в редакторе).

Эвристический инфер sensor_subtype по имени параметра — отдельный модуль
вызывает мэп ниже, но это не часть деривации: предпочитаем явную привязку
из flow.json, а если её нет — НЕ выдумываем.
"""
from __future__ import annotations

from app.schemas.domain import Parameter, RegulationTrigger, RuleDSL


# Эвристика «имя параметра → подтип датчика» — словарь, заполняемый по мере
# появления подтипов. Используется ТОЛЬКО когда:
#   - в flow.json есть input с этим paramRef,
#   - и НЕ привязан sensor-нода через bindsTo.
# Это даёт «лучшую догадку», но не более. Аналитик может перепривязать
# в редакторе триггеров — там значение пользователя приоритетно.
PARAM_TO_SUBTYPE_HINT: dict[str, str] = {
    # Тепло-инциденты — оцифровка СП по тепловым сетям. Подтипы должны
    # существовать в sensor_subtypes (если нет, инфер просто промолчит).
    "inletPressure": "industrial-pressure",
    "pressureFallRate": "industrial-pressure",
    "inletTemperature": "industrial-temp",
    "temperature": "industrial-temp",
    "temperatureRiseRate": "industrial-temp",
    "serverTemperature": "industrial-temp",
    "smokeConcentration": "smoke-detector",
    "coolingFlowRate": "industrial-flow",
    "waterLevel": "water-level",
    "stackFlowRate": "industrial-flow",
    # Воздух — air-quality.
    "windSpeed": "weather-anemometer",
    "pm25Concentration": "air-quality-pm",
    "pm10Concentration": "air-quality-pm",
    "pdkExceedanceHours": "air-quality-pm",
    # ЕДДС / 112.
    "answerTimeSeconds": "edds-call-line",
    "handlingTimeSeconds": "edds-call-line",
    "dispatchTimeMinutes": "edds-call-line",
    "alarmDeliverySeconds": "adpi-gsm",
    "fireDispatchMinutes": "adpi-gsm",
    "operatorConfirmMinutes": "adpi-gsm",
    "monitoringIntervalMinutes": "adpi-gsm",
    "lowBatteryThresholdPercent": "adpi-gsm",
    "falseAlarmRatePercent": "adpi-gsm",
}


PARAM_TO_EVENT_TYPE: dict[str, str] = {
    # Минимальная мапа для демо. Не претендует на полноту — конкретные типы
    # событий должна декларировать СИГМА (см. ТЗ §4 ETL). Сейчас наполняем
    # из того что есть в фикстурах.
    "inletPressure": "telemetry.pressure",
    "pressureFallRate": "telemetry.pressure",
    "inletTemperature": "telemetry.temperature",
    "temperature": "telemetry.temperature",
    "temperatureRiseRate": "telemetry.temperature",
    "serverTemperature": "telemetry.temperature",
    "smokeConcentration": "alert.smoke",
    "waterLevel": "telemetry.water_level",
    "windSpeed": "telemetry.wind",
    "pm25Concentration": "telemetry.air_quality",
    "pm10Concentration": "telemetry.air_quality",
    "answerTimeSeconds": "call.112.received",
    "handlingTimeSeconds": "call.112.handled",
    "dispatchTimeMinutes": "call.112.dispatched",
    "alarmDeliverySeconds": "alert.fire_detector",
    "fireDispatchMinutes": "alert.fire_detector",
}


def derive_triggers_from_flow(
    dsl: RuleDSL,
    *,
    apply_hints: bool = False,
) -> list[RegulationTrigger]:
    """Сгенерировать триггеры из flow.json — ТОЛЬКО для явных bind'ов sensor → input.

    Стратегия (после ревизии 2026-05-18):
      • Создаём триггер только если у input-ноды ЕСТЬ привязанный sensor
        (sensor.bindsTo → input_id, sensor.sensorSubtype заполнен).
      • `apply_hints=True` — opt-in, для legacy-сидов; по умолчанию выключено,
        потому что эвристики PARAM_TO_SUBTYPE_HINT / PARAM_TO_EVENT_TYPE
        создавали ложные привязки. Пользователь видел «уже привязанные»
        датчики, которых он не выбирал, и редактор начинал работать с
        зашумлёнными данными.
      • Триггеры без явного источника НЕ создаются — пустые input-ноды flow
        теперь не превращаются в фантом-триггеры.
    """
    # Индекс: input_node_id → paramRef.
    input_params: dict[str, tuple[str, str | None]] = {}
    for node in dsl.nodes:
        if node.type == "input" and node.paramRef:
            input_params[node.id] = (node.paramRef, node.label)

    # Индекс sensor.bindsTo → sensor_subtype.
    sensor_by_input: dict[str, str] = {}
    for node in dsl.nodes:
        if node.type == "sensor" and node.bindsTo and node.sensorSubtype:
            sensor_by_input[node.bindsTo] = node.sensorSubtype

    triggers: list[RegulationTrigger] = []
    for input_id, (param_ref, label) in input_params.items():
        explicit_subtype = sensor_by_input.get(input_id)
        # БЕЗ явного sensor: opt-in через apply_hints (по умолчанию off).
        if explicit_subtype is None:
            if not apply_hints:
                continue
            subtype = PARAM_TO_SUBTYPE_HINT.get(param_ref)
            event_type = PARAM_TO_EVENT_TYPE.get(param_ref)
            if subtype is None:
                continue
        else:
            subtype = explicit_subtype
            event_type = PARAM_TO_EVENT_TYPE.get(param_ref) if apply_hints else None
        triggers.append(
            RegulationTrigger(
                id=f"trig-{param_ref}",
                label=label or param_ref,
                param_ref=param_ref,
                sensor_subtype=subtype,
                event_type=event_type,
                description=(
                    "Производный триггер из flow.json (sensor явно привязан)"
                    if explicit_subtype
                    else "Производный триггер из flow.json (sensor выведен эвристикой)"
                ),
            )
        )
    return triggers


def reconcile_triggers_with_flow(
    existing: list[RegulationTrigger],
    dsl: RuleDSL,
    parameters: list[Parameter],
) -> list[RegulationTrigger]:
    """Sync Flow → Triggers: согласовать триггеры регламента с актуальным flow.

    Вызывается из PUT /regulations/{id}/flow после save_flow + derive_params.
    Закрывает дыру: пользователь перетащил sensor-ноду в Flow Editor — но
    декларация триггера в регламенте оставалась прежней, виден разрыв в
    Turtle / Edit / Sensor Library reverse-lookup.

    Стратегия (приоритет — НЕ затирать ручной ввод пользователя):
      1) Если в flow появилась ЯВНАЯ привязка sensor → input (через
         sensor.bindsTo), обновляем sensor_subtype триггера соответствующего
         input.paramRef. Это «пользователь нарисовал sensor на канвасе —
         хочу чтобы это попало в декларацию».
      2) Если в flow привязки нет, но триггер уже есть (был отредактирован
         руками в Edit/«Триггеры»), оставляем sensor_subtype как есть —
         ручной ввод приоритетен. Меняем только label если он раньше был
         равен param_ref (auto-сгенерирован).
      3) Если в flow есть input.paramRef, но триггера для него нет — создаём
         новый триггер (sensor_subtype из flow если есть, иначе None;
         event_type — по эвристике PARAM_TO_EVENT_TYPE).
      4) Orphan-триггеры (param_ref которого нет ни в parameters, ни в input-
         нодах flow) — удаляем. Это нормальная зачистка после рефакторинга
         регламента; если триггер был кустарным (без параметра), он удалится
         когда пользователь удалит соответствующий параметр.

    Параметры передаём отдельно (`parameters`) потому что после save_flow
    они уже синхронизированы с flow через derive_params_from_flow — это
    источник правды о том, что есть в регламенте сейчас.
    """
    # Индекс существующих триггеров по param_ref. param_ref уникален в рамках
    # регламента de facto (UI не позволяет два триггера на один параметр),
    # хотя SHACL это пока не enforces. Если дубли есть — берём первый.
    existing_by_param: dict[str, RegulationTrigger] = {}
    for t in existing:
        existing_by_param.setdefault(t.param_ref, t)

    # Индекс flow: input_id → (paramRef, label)
    input_params: dict[str, tuple[str, str | None]] = {}
    for node in dsl.nodes:
        if node.type == "input" and node.paramRef:
            input_params[node.id] = (node.paramRef, node.label)
    # Индекс sensor: input_id → sensor_subtype
    sensor_by_input: dict[str, str] = {}
    for node in dsl.nodes:
        if node.type == "sensor" and node.bindsTo and node.sensorSubtype:
            sensor_by_input[node.bindsTo] = node.sensorSubtype

    # Множество допустимых param_ref'ов: всё что есть в parameters + всё что
    # есть в flow inputs. Триггеры с param_ref вне этого множества — orphans,
    # вычистим.
    valid_param_refs = {p.name for p in parameters} | {
        pr for (pr, _) in input_params.values()
    }

    out: list[RegulationTrigger] = []

    # Первый проход: триггеры для input-нод flow (порядок берём из flow,
    # это даёт стабильный визуальный порядок в UI).
    handled_param_refs: set[str] = set()
    for input_id, (param_ref, label) in input_params.items():
        handled_param_refs.add(param_ref)
        explicit_subtype = sensor_by_input.get(input_id)
        prior = existing_by_param.get(param_ref)
        if prior is not None:
            # Обновляем существующий триггер. Не затираем ручной ввод:
            #   - sensor_subtype: если flow дал явный sensor → обновляем;
            #     иначе оставляем как было (мог быть выбран в секции «Триггеры»).
            #   - event_type / description: оставляем как было (пользователь
            #     мог дописать руками).
            #   - label: обновляем только если был auto-сгенерирован (== param_ref);
            #     если пользователь дал свой — оставляем.
            new_label = prior.label
            if new_label in (None, "", prior.param_ref) and label:
                new_label = label
            new_subtype = (
                explicit_subtype
                if explicit_subtype is not None
                else prior.sensor_subtype
            )
            out.append(
                RegulationTrigger(
                    id=prior.id,
                    label=new_label,
                    param_ref=param_ref,
                    sensor_subtype=new_subtype,
                    event_type=prior.event_type,
                    description=prior.description,
                )
            )
        else:
            # Новый триггер. Создаём ТОЛЬКО если sensor привязан в flow
            # явно (sensor.bindsTo на этот input). Без явной привязки
            # пользователь сам решит, какой источник нужен — иначе мы
            # бы пре-заполнили триггеры эвристикой и засорили редактор.
            if explicit_subtype is None:
                continue
            out.append(
                RegulationTrigger(
                    id=f"trig-{param_ref}",
                    label=label or param_ref,
                    param_ref=param_ref,
                    sensor_subtype=explicit_subtype,
                    event_type=None,
                    description="Создан из flow: sensor привязан явно",
                )
            )

    # Второй проход: триггеры, которых нет в input-нодах flow, но которые
    # ссылаются на существующие параметры. Сохраняем (пользователь мог
    # создать триггер вручную в Edit, не заводя input-ноду в flow). Те,
    # что ссылаются на удалённые параметры (orphan), пропускаем.
    for param_ref, t in existing_by_param.items():
        if param_ref in handled_param_refs:
            continue
        if param_ref in valid_param_refs:
            out.append(t)
        # else: orphan → удаляем

    return out


def derive_triggers_from_parameters(
    parameters: list[Parameter],
    *,
    apply_hints: bool = False,
) -> list[RegulationTrigger]:
    """По умолчанию возвращает пустой список — авто-триггеры отключены.

    Раньше эта функция создавала триггер на каждый параметр с эвристически
    выведенным sensor_subtype (PARAM_TO_SUBTYPE_HINT). Это пре-заполняло
    редактор привязками, которых пользователь не делал, и засоряло
    `regulation_triggers` фантом-записями.

    `apply_hints=True` оставляем как opt-in для тестов / возможной CLI-
    утилиты «преднабор по эвристике». В сидинге и backfill'е больше не
    зовётся.
    """
    if not apply_hints:
        return []
    triggers: list[RegulationTrigger] = []
    for p in parameters:
        subtype = PARAM_TO_SUBTYPE_HINT.get(p.name)
        event_type = PARAM_TO_EVENT_TYPE.get(p.name)
        if subtype is None:
            continue
        triggers.append(
            RegulationTrigger(
                id=f"trig-{p.name}",
                label=p.name,
                param_ref=p.name,
                sensor_subtype=subtype,
                event_type=event_type,
                description="Производный триггер из параметров (flow.json отсутствует)",
            )
        )
    return triggers

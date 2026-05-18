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
    apply_hints: bool = True,
) -> list[RegulationTrigger]:
    """Сгенерировать триггеры из flow.json.

    Стратегия:
      1. Для каждой input-ноды собираем paramRef.
      2. Ищем sensor-ноду, у которой `bindsTo` указывает на эту input-ноду —
         если есть, берём её `sensorSubtype`.
      3. Если sensor не нашёлся и `apply_hints=True` — пытаемся вывести
         sensor_subtype из PARAM_TO_SUBTYPE_HINT.
      4. Аналогично event_type — из PARAM_TO_EVENT_TYPE.

    Триггер с пустым param_ref не создаётся (input-нода без paramRef =
    битый flow, пропускаем).
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
        subtype = explicit_subtype
        if subtype is None and apply_hints:
            subtype = PARAM_TO_SUBTYPE_HINT.get(param_ref)
        event_type = PARAM_TO_EVENT_TYPE.get(param_ref) if apply_hints else None
        triggers.append(
            RegulationTrigger(
                # ID триггера — стабильный slug от param_ref. Один input-узел
                # = один триггер, поэтому коллизий не будет.
                id=f"trig-{param_ref}",
                label=label or param_ref,
                param_ref=param_ref,
                sensor_subtype=subtype,
                event_type=event_type,
                description=(
                    "Производный триггер из flow.json"
                    + (" (sensor явно привязан)" if explicit_subtype else " (sensor выведен эвристикой)")
                ),
            )
        )
    return triggers


def derive_triggers_from_parameters(
    parameters: list[Parameter],
    *,
    apply_hints: bool = True,
) -> list[RegulationTrigger]:
    """Fallback-деривация когда flow.json у регламента ещё нет.

    Применяется к регламентам, которые имеют параметры в Turtle, но Flow
    Editor для них ещё не открывали (нет файла `data/flows/<sid>.json`).
    Такие регламенты иначе остались бы без триггеров — и event-driven
    маршрутизация на них не работала бы. Один триггер на каждый параметр,
    sensor_subtype/event_type выводятся из эвристики PARAM_TO_*.

    Аналитик потом может перепривязать датчик или удалить лишний триггер
    в UI — это всё лишь дефолтная заполненность.
    """
    triggers: list[RegulationTrigger] = []
    for p in parameters:
        subtype = PARAM_TO_SUBTYPE_HINT.get(p.name) if apply_hints else None
        event_type = PARAM_TO_EVENT_TYPE.get(p.name) if apply_hints else None
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

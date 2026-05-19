"""Pydantic models — request/response shape for the RAGRAF API layer.

Mirrors the TypeScript domain in regulation-viz-skill.md § Domain Model.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# --- Core domain --------------------------------------------------------


class Parameter(BaseModel):
    id: str
    name: str
    datatype: Literal["decimal", "string", "date", "boolean"] = "decimal"
    referenceValue: float | None = None
    minInclusive: float | None = None
    maxInclusive: float | None = None
    deviationAllowed: float | None = None
    unit: str | None = None


class Constraint(BaseModel):
    id: str
    targetClass: str = "Regulation"
    path: str
    datatype: str | None = None
    minCount: int | None = None
    maxCount: int | None = None
    minInclusive: float | None = None
    maxInclusive: float | None = None
    pattern: str | None = None
    message: str | None = None
    severity: Literal["violation", "warning", "info"] = "violation"


class Recommendation(BaseModel):
    """Текстовая рекомендация регламента + приоритет (severity).

    После аудита 2026-05-18 поля упрощены:
      • `condition: ConditionExpression` — было мёртвое поле без UI / DB-
        колонки / сериализации в Turtle. Удалено: условие срабатывания
        регламента живёт в Flow Editor (compare/switch/formula ноды),
        не в текстовом блоке рекомендации.
      • `linkedParameters` — раньше регенерилось `= [p.id for p in parameters]`
        на каждом save (UI не давал выбрать подмножество). Оставлено, но
        с default=[] — клиент может его игнорировать; backend регенерит
        в save() если пусто.
    """
    id: str
    text: str
    priority: Literal[1, 2, 3] = 2
    linkedParameters: list[str] = Field(default_factory=list)


class RegulationTrigger(BaseModel):
    """Декларативная привязка «вход регламента → источник события».

    Закрывает архитектурный разрыв event-driven Сигмы: раньше связь
    «датчик → параметр регламента» жила ТОЛЬКО в flow.json (через цепочку
    `sensor.bindsTo → input.paramRef`), без явной декларации в Turtle.
    Это значит ETL-приёмнику нужно было обходить все flow.json чтобы найти
    «какие регламенты слушают этот сенсор». На N=10 регламентов терпимо,
    на N=10К — катастрофа.

    Один регламент = несколько триггеров (по числу входных параметров).
    Пример heat-inlet-breach: 3 триггера — inletPressure / pressureFallRate /
    inletTemperature, каждый со своим датчиком и типом события.

    Поля:
      - `id` — уникален в рамках регламента (kebab-case, например 'pressure-in').
      - `label` — UI-имя ("Давление на входе").
      - `param_ref` — ID параметра регламента, который наполняется триггером
        (FK на Parameter.name). Используется flow_executor.py для resolve.
      - `sensor_subtype` — FK на SensorSubtype.subtype_id. None если триггер
        не привязан к конкретному датчику (например, ручной ввод оператором).
      - `event_type` — тип события в ETL-шине ('telemetry.pressure',
        'video.intrusion'). None если фид сырой.
      - `source_regulation` — FK на Regulation.id ДРУГОГО регламента, чей
        output служит триггером. Используется для композиции регламентов:
        регламент B активируется при срабатывании output'а регламента A.
        Взаимоисключающее с sensor_subtype (триггер либо «слушаю датчик»,
        либо «слушаю выход регламента»), но обоюдно опциональны.
      - `source_output` — action из output-ноды другого регламента
        (например 'smart_valve_close', 'request_walker_confirm'). Имеет
        смысл только когда задан source_regulation. None = слушаем любой
        вердикт регламента-источника.
      - `description` — дополнительное пояснение.

    Сериализация в data.ttl (см. turtle_bridge.py):
        :reg :hasTrigger :reg-pressure-in .
        :reg-pressure-in a :Trigger ;
            rdfs:label "Давление на входе" ;
            :paramRef "inletPressure" ;
            :sensorSubtype "industrial-pressure" ;
            :eventType "telemetry.pressure" .

    Индекс в DuckDB (regulation_triggers) позволяет за один SELECT найти
    «какие регламенты слушают sensor_subtype=X» — это и есть O(1) маршрутизация.
    """
    id: str
    label: str | None = None
    param_ref: str
    sensor_subtype: str | None = None
    event_type: str | None = None
    source_regulation: str | None = None
    source_output: str | None = None
    description: str | None = None


class Regulation(BaseModel):
    id: str
    name: str
    domain: str | None = None  # smysl domain ID: "heating", "housing", ...
    date: str | None = None
    version: str = "1.0"
    status: Literal["active", "draft", "archived"] = "draft"
    parameters: list[Parameter] = Field(default_factory=list)
    constraints: list[Constraint] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)
    # Декларативные триггеры — на какие события/датчики реагирует регламент.
    # Список потому что у регламента может быть несколько входов (давление +
    # температура + расход — три разных датчика, каждый свой триггер).
    # Подробнее: RegulationTrigger выше.
    triggers: list["RegulationTrigger"] = Field(default_factory=list)
    # SIGMA-compliance (ТЗ §4.1.3 «каждое правило связано с источником,
    # периодом действия и историей изменений»):
    # - source_document: название нормативного акта («СП 124.13330.2012»)
    # - source_clause:   пункт / раздел внутри документа («§5.10», «п. 7.2.3»)
    # - valid_from / valid_to: ISO-даты периода действия (опционально)
    # Нужно для объяснимости решений (§4.2.2 #3) и применения «тех правил,
    # которые действовали на момент возникновения события» (§4.1.3).
    source_document: str | None = None
    source_clause: str | None = None
    valid_from: str | None = None
    valid_to: str | None = None
    # PROV-O attachment: документ-основание (вариант B — локальный кэш).
    # Сценарий: аналитик оцифровал бумажный приказ в цифровой регламент и
    # хочет иметь возможность вернуться к оригиналу для самопроверки и
    # обоснования значений параметров перед заказчиком.
    #   - source_url:      внешняя ссылка (Yandex Disk, intranet, mailto:...)
    #   - source_excerpt:  фрагмент текста-цитата, объясняющий откуда взялись
    #                      конкретные значения (например 20.5 атм и 1.5 отклонение)
    #   - source_file_path: относительный путь в `data/source_documents/{id}/`
    #                      когда оригинал загружен локально (опционально)
    #   - source_checksum: sha256 локального файла — поймать подмену оригинала
    #                      между сессиями и при reimport bundle'а
    #   - source_mime_type: media type загруженного файла (UI решает как превьюшить)
    # Сериализуются в data.ttl через PROV-O (prov:wasDerivedFrom + prov:Entity).
    source_url: str | None = None
    source_excerpt: str | None = None
    source_file_path: str | None = None
    source_checksum: str | None = None
    source_mime_type: str | None = None


# --- Module passport (СИГМА § 7 «API и интеграционный контракт») --------
#
# «Прикладной модуль» в архитектуре СИГМА — внешняя подсистема-источник
# событий (DAS-волокно, мониторинг шума, теплосети как поставщик ETL,
# АДПИ GSM пожарные извещатели, видеоаналитика Нетрис, ANPR Войслинк).
# Каждый модуль может содержать N датчиков (sensor_subtypes), но
# рассматривается как одна точка интеграции с собственным контрактом.
#
# Паспорт = формальная декларация для приёмки модуля: кто владеет, какие
# события генерирует, как подключается, какие требования к качеству,
# статус готовности. Аналог «module manifest» из exposable platforms.


class ModuleApiContract(BaseModel):
    """Канал обмена с модулем — REST API / webhook / очередь."""

    channel: Literal["rest", "webhook", "queue", "file_drop", "other"] = "rest"
    url: str | None = None
    auth_type: Literal["none", "api_key", "oauth2", "mtls", "basic"] = "none"
    event_format: Literal["json", "xml", "csv", "binary", "other"] = "json"
    rate_limit: str | None = None  # «100 событий/сек», «1000 событий/мин»
    notes: str | None = None


class ModuleQualityRules(BaseModel):
    """Требования к качеству данных от модуля."""

    completeness: str | None = None  # «≥ 99% обязательных полей заполнены»
    max_latency_seconds: int | None = None  # «event должен прийти ≤ 60 сек после факта»
    max_error_rate_percent: float | None = None  # «≤ 0.1% невалидных событий»
    deduplication: bool = True  # дедуп по event_id


class Module(BaseModel):
    """Паспорт прикладного модуля (источника событий) — § 7 СИГМА.

    Хранится в DuckDB-таблице `modules`. Каждый sensor_subtype опционально
    привязан к модулю через FK `sensor_subtypes.module_id` — это даёт
    обратный lookup «какой датчик принадлежит какому внешнему модулю»
    (полезно для оператора СЦ при определении источника сбоя).

    Регламенты НЕ хранят ссылку на модуль напрямую — связь идёт через
    sensor_subtype, который указан в RegulationTrigger.sensor_subtype.
    Это даёт композицию «модуль → датчик → триггер → регламент» без
    жёсткого coupling'а регламентов и модулей.
    """

    id: str  # kebab-slug, например `das-fiber-monitoring`
    name: str
    purpose: str = ""  # для чего модуль нужен на платформе
    owner: str | None = None  # «АО Дунай-Связь», «ЦИИНГУ НГУ», ...
    domain: str | None = None  # связь с доменом регламентов (heating, safety, ...)
    status: Literal["draft", "piloting", "production", "deprecated"] = "draft"
    version: str = "1.0"
    icon: str | None = None  # ID иконки из DOMAIN_ICONS_REGISTRY (фронт)
    color: str | None = None  # tone (orange/blue/...)

    # Контракт интеграции
    api_contract: ModuleApiContract = Field(default_factory=ModuleApiContract)
    quality_rules: ModuleQualityRules = Field(default_factory=ModuleQualityRules)

    # Декларация событий: какие event_type'ы модуль производит
    # (matches RegulationTrigger.event_type). Поле опциональное —
    # не все модули формализуют типы событий заранее.
    event_types: list[str] = Field(default_factory=list)

    # Контакты / документация
    contact_email: str | None = None
    documentation_url: str | None = None

    # Заметки / ограничения / правовые основания (152-ФЗ для медицинских)
    notes: str | None = None


# --- Rule DSL -----------------------------------------------------------


NodeKind = Literal[
    "input", "threshold", "compare", "formula", "switch", "output", "shacl_constraint",
    # Точка привязки к внешнему сигналу ETL/IoT. На канвасе рисуется кружком,
    # ребром привязан к input-ноде регламента — телеграфирует «вот этот
    # внешний сигнал наполняет вот этот параметр». См. README §«Исполнение
    # регламента» и app/services/flow_executor.py.
    "sensor",
]


# Тип физического датчика (соответствует `type` в ETL-payload'е СИГМЫ).
# Литерал держим узким, чтобы UI мог раскрасить кружок по типу:
#   p     — pressure (давление, манометр / преобразователь давления),
#   t     — temperature (температура, термопара / RTD),
#   flow  — расход (м³/ч, электромагнитный/ультразвуковой расходомер),
#   noise — акустический датчик (детектор утечки и т.п.),
#   detector — видеодетектор (CCTV-аналитика),
#   fiber — распределённое оптоволокно (DAS, Distributed Acoustic Sensing):
#           кабель сам является датчиком на всю длину; ML-классификатор
#           возвращает категориальное событие + координату вдоль волокна.
#           См. event-data-examples/sensors/fiber/.
#   air   — датчики качества воздуха (CO2, PM2.5, PM10, NO2, …) — типовой
#           блок проекта ГОРОД-ОМ-ИИ / ВОЗДУХ-ОМ. Шлёт семантические
#           события «концентрация превышает норму», не сырую телеметрию.
#           См. event-data-examples/sensors/air/.
# Расширяемо: при добавлении нового типа правим литерал тут + UI palette.
# История: тип "d" (diameter) убран — диаметр трубы это конструктивный
# параметр (мерят штангенциркулем один раз при монтаже), а не runtime-сигнал.
SensorType = Literal["p", "t", "flow", "noise", "detector", "fiber", "air"]


class FlowNode(BaseModel):
    id: str
    type: NodeKind
    label: str | None = None
    position: dict[str, float] | None = None  # {x, y}
    # type-specific config — kept loose so node types stay extensible
    paramRef: str | None = None
    refValue: float | None = None
    deviation: float | None = None
    operator: str | None = None
    expression: str | None = None
    cases: list[dict[str, Any]] | None = None
    action: str | None = None
    text: str | None = None
    priority: int | None = None
    constraintRef: str | None = None
    unit: str | None = None
    # Sensor-specific (только для type == "sensor"):
    #   sensorType    — категория физического датчика (см. SensorType)
    #   sensorSubtype — конкретный подтип (например 'vd-anpr', 'fiber-vibration').
    #                   Если задан, JSON-схема payload берётся из реестра
    #                   sensor_field_schemas по subtype_id; иначе — из generic-
    #                   подтипа, у которого subtype_id == sensorType.
    #   bindsTo       — id input-ноды, в которую сенсор инжектирует значение.
    #                   None пока сенсор не привязан (висит на канвасе) — в этом
    #                   случае executor его игнорирует.
    #   externalId    — необязательный «ярлык» из ETL (например `edge_1` —
    #                   идентификатор участка трубопровода). Не используется
    #                   в логике, но прокидывается обратно в trace для UI.
    sensorType: SensorType | None = None
    sensorSubtype: str | None = None
    bindsTo: str | None = None
    externalId: str | None = None
    # Композиция регламентов через канвас (зеркалит RegulationTrigger.source_*):
    #   sourceKind          — переключатель «слушаю датчик ИЛИ выход другого регламента».
    #                         None / 'sensor' = обычный датчик (старое поведение).
    #                         'regulation' = sensorType/sensorSubtype/externalId игнорятся,
    #                         вместо них значение подаётся output-action'ом другого регламента.
    #   sourceRegulationId  — FK на Regulation.id другого регламента (cross-domain допустим).
    #   sourceOutputAction  — action из output-ноды того регламента (как 'smart_valve_close').
    #                         Если строка не найдена в /output-actions источника — UI показывает
    #                         red badge «связь сломана» (см. PropertyPanel sensor-секция).
    # На save_flow() backend синхронизирует RegulationTrigger-записи: для каждого
    # sensor с sourceKind='regulation' создаётся/обновляется триггер на регламенте,
    # которому принадлежит flow, чтобы reverse-lookup `/triggered-by` работал.
    sourceKind: Literal["sensor", "regulation"] | None = None
    sourceRegulationId: str | None = None
    sourceOutputAction: str | None = None


class FlowEdge(BaseModel):
    source: str
    target: str
    condition: str | None = None


class RuleDSL(BaseModel):
    rule_id: str
    regulation_id: str
    nodes: list[FlowNode] = Field(default_factory=list)
    edges: list[FlowEdge] = Field(default_factory=list)


# --- Process / Operational Digital Twin ---------------------------------
#
# Process — именованный «цифровой двойник управленческого процесса».
# Сущность, объединяющая несколько регламентов в одну операционную картину:
# аналитик собирает 2-N регламентов, видит граф их композиционных связей
# (через :sourceRegulation триггеры), симулирует сценарии на цепочке,
# экспортирует артефакт (Turtle / SIGMA-bundle ZIP).
#
# Архитектурно это **view-of-the-system**, не функциональная единица:
# регламенты остаются авторитативными в `regulations`, Process только
# собирает их в логическую группу и даёт UI/экспорт операций над группой.
# Удаление Process не удаляет регламенты — это просто разгруппировка.
#
# Хранение: `processes` DuckDB-таблица с JSON-полем `regulation_ids`
# (списком идентификаторов). M:N через JSON, а не через отдельную таблицу
# `process_regulations` — потому что список малый (типично 2-10), порядок
# важен для UI (как у user_domains.list), и денормализация даёт более
# читаемый snapshot.


class Process(BaseModel):
    id: str
    name: str
    description: str | None = None
    # Список ID регламентов, собранных в этот процесс. Порядок UI-важен:
    # отражает «верхнеуровневую → низкоуровневую» цепочку как её видит
    # аналитик. Не валидируем на существование регламентов здесь —
    # это делается на read через JOIN в process_store.
    regulation_ids: list[str] = Field(default_factory=list)
    # ISO datetime, выставляется в process_store. None на новом черновике
    # до первого save.
    created_at: str | None = None
    updated_at: str | None = None


# --- Validation ---------------------------------------------------------


class ValidationError(BaseModel):
    nodeId: str | None = None
    edgeId: str | None = None
    code: str
    message: str
    severity: Literal["error", "warning"] = "error"


class ValidationResult(BaseModel):
    valid: bool
    errors: list[ValidationError] = Field(default_factory=list)


# --- Versioning ---------------------------------------------------------


class FlowVersion(BaseModel):
    version_id: str
    regulation_id: str
    created_at: str
    author: str = "anonymous"
    comment: str | None = None
    dsl_snapshot: RuleDSL
    diff_summary: str | None = None


# --- Graph (Cytoscape) --------------------------------------------------


class CyNodeData(BaseModel):
    id: str
    label: str
    type: str
    description: str | None = None
    regulation_id: str | None = None
    domain: str | None = None  # for client-side filtering / grouping


class CyEdgeData(BaseModel):
    id: str
    source: str
    target: str
    label: str | None = None
    weight: float | None = None


class CyNode(BaseModel):
    data: CyNodeData


class CyEdge(BaseModel):
    data: CyEdgeData


class GraphPayload(BaseModel):
    nodes: list[CyNode]
    edges: list[CyEdge]
    meta: dict[str, int] = Field(default_factory=dict)


# --- Sensor schema registry --------------------------------------------
#
# Каждое поле payload каждого типа датчика описано отдельной записью.
# Это позволяет аналитику добавлять/менять поля из UI без правок кода —
# например «у нас новый датчик влажности, добавляю поле `humidity` с
# единицей %RH к типу `air`». См. event-data-examples/sensors/ как
# реальный referral; начальный seed строится из этого справочника.


class SensorSubtype(BaseModel):
    """Подтип датчика — конкретная модель внутри класса.

    Класс — это литерал `SensorType` ('detector', 'fiber', …) — coarse-grained
    семейство (видеодетектор / оптоволокно DAS / …). Подтип — конкретный
    «продукт» внутри класса (ANPR / person / trash-bin / das-vibration /
    das-acoustic). У каждого подтипа свой набор payload-полей.

    Под одним классом могут быть desятки подтипов (например, ~20
    видеодетекторов). Аналитик добавляет их из UI через CRUD на /sensors —
    никаких правок в коде не требуется.
    """
    subtype_id: str             # глобально уникальный, kebab-case: 'anpr', 'das-acoustic'
    class_id: str               # один из литералов SensorType: 'detector', 'fiber', ...
    label: str                  # 'ANPR (распознавание ГРЗ)' — для UI
    description: str | None = None
    position: int = 0           # порядок внутри класса


class SensorField(BaseModel):
    """Описание одного поля payload-объекта датчика. Привязано к подтипу."""
    subtype_id: str   # FK на SensorSubtype.subtype_id
    field_name: str   # имя поля в payload, напр. 'pressure' / 'event' / 'numberPlate'
    datatype: Literal["decimal", "integer", "string", "boolean"] = "decimal"
    unit: str | None = None          # 'atm' / '°C' / 'ppm' / 'µg/m³' / None
    description: str | None = None    # человекочитаемое описание
    required: bool = False            # обязательное поле для валидации
    example_value: str | None = None  # пример (JSON-строка)
    position: int = 0                 # порядок в UI


class SensorFieldsByType(BaseModel):
    """Поля одного подтипа — для GET /api/sensor-schemas/{subtype_id}."""
    subtype_id: str
    fields: list[SensorField] = Field(default_factory=list)


class SensorClassWithSubtypes(BaseModel):
    """Класс датчиков (литерал SensorType) и его подтипы — для tree-UI."""
    class_id: str
    subtypes: list[SensorSubtype] = Field(default_factory=list)


# --- Extraction dictionary ---------------------------------------------
#
# Словарь «русский стем → имя параметра» для rules-based извлечения
# параметров из произвольного текста регламента. Раньше хардкод в коде —
# теперь редактируемый набор пар. Аналитик «дообучает» движок добавляя
# нераспознанные слова. См. extraction_term_store.py.

class ExtractionTerm(BaseModel):
    stem: str                       # «давлен», «температур» — стем для подстрочного поиска
    parameter_name: str             # «pressure», «temperature» — что предложить
    domain: str | None = None       # heating / housing / safety / environment / None (cross-domain)
    unit_hint: str | None = None    # 'атм' / '°C' — подсказка для UI (необязательно)
    source: Literal["seed", "user"] = "seed"  # помечает откуда взялся термин — для UI


class DomainScore(BaseModel):
    """Голоса за домен по результатам извлечения."""
    domain: str
    hits: int                       # сколько extract'ов сматчилось на термин этого домена
    confidence: float               # 0..1 — доля от total_hits


# --- Search (RAGU) ------------------------------------------------------


class SearchRequest(BaseModel):
    query: str
    mode: Literal["local", "global", "naive"] = "local"


class SearchHit(BaseModel):
    id: str
    label: str
    type: str | None = None
    score: float | None = None


class SearchResponse(BaseModel):
    response: str
    entities: list[SearchHit] = Field(default_factory=list)
    sources: list[dict[str, Any]] = Field(default_factory=list)

# event-data-examples

Песочница примеров событий, которые система СИГМЫ ожидает получать от
внешних источников (датчиков, видеоаналитики, ETL-конвейеров). Используем
эту папку как «живую» спеку: когда добавляется новый тип датчика —
кладём сюда JSON-сэмпл, он становится частью нашего контракта.

## Структура

```
event-data-examples/
├── README.md                       — эта навигация
├── schema.json                     — JSON Schema события (формальный контракт)
├── sigma-snapshot-2026-05-17.json  — снимок 503 событий с боевого endpoint'а
├── sigma_event_generator/          — эмулятор DAS-источника на Triton (исходный код)
├── videodetectors/                 — продакшн-схемы видеодетекторов (SQLAlchemy ORM)
│   ├── person_postgresql.py         — EventPerson (76+ атрибутов человека)
│   ├── grz_postgresql.py            — EventNumberPlate / ANPR (номер, марка, цвет…)
│   ├── models.py                    — упрощённая dataclass Event для mock-генератора
│   └── generator.py                 — генератор случайных событий в Postgres
└── sensors/                        — библиотека типов датчиков (JSON-сэмплы)
    ├── README.md                   — список типов + правила добавления
    ├── pressure/                   — манометры (тип `p`)
    ├── temperature/                — термопары / RTD (тип `t`)
    ├── flow/                       — расходомеры (тип `flow`)
    ├── noise/                      — точечные акустические детекторы (тип `noise`)
    ├── air/                        — качество воздуха CO2/PM2.5 (тип `air`, ВОЗДУХ-ОМ)
    ├── video-detector/             — CCTV-аналитика (тип `detector`) — person + ANPR
    └── fiber/                      — распределённое оптоволокно DAS (тип `fiber`)
```

## Ключевой принцип: edge-детектор, не сырая телеметрия

> Из отчёта ЦИИНГУ-2024 «Шаблон событий» (§2): «надо данные **агрегировать
> на местах**, обрабатывать и получать **более крупные события**, и их
> уже заводить во фреймворк (например, только при превышении шума, а не
> просто значение амплитуды по тысяче раз в секунду)».

Любой внешний модуль (ВОЗДУХ-ОМ, ШУМ-ИИ, видеодетекторы, оптоволокно)
имеет **собственный детектор внутри**, который превращает поток сырых
замеров в редкие семантические события. В СИГМУ / RAGRAF летит только
второе: «CO2 превысил 1000 ppm», «по акустической сигнатуре определён
поезд», «обнаружена копка на 3946 м».

Сравнить, как это выглядит в кодах:
- Сырое (не отправляется): [sensors/noise/raw-triplet.json](sensors/noise/raw-triplet.json)
- Семантическое (отправляется): [sensors/noise/vehicle-train.json](sensors/noise/vehicle-train.json),
  [sensors/air/co2-exceed.json](sensors/air/co2-exceed.json),
  [sensors/fiber/digging.json](sensors/fiber/digging.json).

## Контракт события

Любое входящее событие — это JSON с тремя обязательными полями:

```json
{
  "description": "Падение давления на узле подачи",
  "timestamp": "2026-03-13T12:15:30Z",
  "payload": {
    "x": 345.7,
    "y": 128.2,
    "pressure": 4.1,
    "temperature": 92.5
  }
}
```

| Поле          | Тип        | Назначение                                                  |
|---------------|------------|-------------------------------------------------------------|
| `description` | string     | Краткое описание для пользователя в журнале событий          |
| `timestamp`   | ISO date-time | Время обнаружения события                                |
| `payload`     | object     | Распознанные параметры. Структура произвольная — конкретный набор зависит от датчика (см. `sensors/<type>/README.md`). |

Формальная JSON Schema лежит в [schema.json](schema.json).

### Wire-формат: обёртка `msg`

При **POST'е события в СИГМУ** допустимо завернуть тело в одно поле `msg`:

```json
{
  "msg": {
    "description": "pressure_drop_detected",
    "timestamp": "2026-03-13T12:16:30Z",
    "payload": {
      "x": 345.7, "y": 128.2,
      "pressure": 4.1, "temperature": 92.5
    }
  }
}
```

При **GET'е из СИГМЫ** ответ всегда обёрнут — каждый элемент массива:

```json
{
  "id": 1860,                                      // server-assigned
  "source_id": "3cf6f24b-2dda-4657-92af-43cfb42d3c2e",
  "msg": { "description": ..., "timestamp": ..., "payload": ... },
  "level": null,                                   // вердикт (пока пусто)
  "regulations": [],                               // привязанные регламенты (пока пусто)
  "created_at": "2026-05-17T02:26:05.881255Z",
  "updated_at": "2026-05-17T02:26:05.881257Z"
}
```

`level` и `regulations` — слоты, куда оценщик регламентов (СИГМА или RAGRAF
в будущем) **должен записывать вердикт**. На снимке от 2026-05-17 все 503
события приходят с `level: null, regulations: []` — система собирает поток,
но ещё не оценивает. См. [BACKLOG.md](../BACKLOG.md) §«Приёмник событий СИГМЫ».

## Поток данных

```
[физический датчик] → [edge-устройство / Triton-модель] → POST /events
                          │
                          ▼
                     SIGMA Core (sources/<uuid>/events/)
                          │
                          ▼
                     RAGRAF receiver (в бэклоге) → flow_executor → вердикт
```

Сейчас (май 2026) приёмник событий на стороне RAGRAF не реализован — это
в [BACKLOG.md](../BACKLOG.md). Пока используем эти JSON-сэмплы как:

1. **Тестовые данные для симуляции** в [ExecutePanel](../frontend/src/components/flow/ExecutePanel.tsx)
2. **Документацию контракта** для тех, кто будет писать адаптер
3. **Эталон для маппинга** `payload.<field>` → `SensorReading` в [flow_executor.py](../backend/app/services/flow_executor.py)

## Эмулятор источника

В [sigma_event_generator/](sigma_event_generator/) — рабочий генератор:
FastAPI + Triton-модель, которая раз в `BASE_INTERVAL_MIN ± JITTER_MIN`
минут синтезирует событие и шлёт POST на `TARGET_URL`. Используется
самой СИГМОЙ для нагрузочного тестирования и e2e-проверок без живых
датчиков. Подробнее — в [sigma_event_generator/README.md](sigma_event_generator/README.md).

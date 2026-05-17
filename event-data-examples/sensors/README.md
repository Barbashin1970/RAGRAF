# Библиотека типов датчиков

Каждая папка соответствует одному типу датчика (literal `SensorType` из
[backend/app/schemas/domain.py](../../backend/app/schemas/domain.py)).
Внутри — JSON-сэмплы событий + per-type README с расшифровкой полей
`payload`.

## Типы датчиков

| Тип        | Что меряет                            | Папка                              | UI-чип |
|------------|--------------------------------------|-----------------------------------|--------|
| `p`        | Давление (атм / бар)                  | [pressure/](pressure/)            | p, blue |
| `t`        | Температура (°C)                      | [temperature/](temperature/)      | t, rose |
| `flow`     | Расход (м³/ч)                         | [flow/](flow/)                    | Q, cyan |
| `noise`    | Акустический детектор (точечный)       | [noise/](noise/)                  | N, amber |
| `air`      | Качество воздуха (CO2/PM2.5/PM10/NO2)  | [air/](air/)                      | A, sky |
| `detector` | Видеодетектор CCTV (person + ANPR)     | [video-detector/](video-detector/) | V, violet |
| `fiber`    | Распределённое оптоволокно (DAS)       | [fiber/](fiber/)                  | F, indigo |

Цвета чипов прописаны в `SENSOR_TYPE_META` в [frontend/src/lib/api.ts](../../frontend/src/lib/api.ts).

### Принцип «edge-детектор, не сырая телеметрия»

Из отчёта ЦИИНГУ-2024 «Шаблон событий» (§2, §3 п.7): внешние модули
**не должны слать в СИГМУ всю сырую телеметрию** — это перегружает
брокер. У каждого источника есть **свой edge-детектор**, который
агрегирует / классифицирует на месте и отправляет только семантическое
событие.

```
датчик (raw телеметрия 1..10 кГц)
  ↓ NOT sent
edge-агрегатор: пороги / FFT / ML-классификация
  ↓ semantic event (1/мин или реже)
СИГМА / RAGRAF
```

Эту разницу видно в [noise/raw-triplet.json](noise/raw-triplet.json) (сырой
формат, помечен «не отправляется») vs [noise/vehicle-train.json](noise/vehicle-train.json) /
[noise/noise-threshold-exceed.json](noise/noise-threshold-exceed.json)
(семантические события — то, что реально летит на API).

### Телеметрические vs. триггерные

| Класс         | Типы              | Поведение                                             |
|---------------|-------------------|------------------------------------------------------|
| Телеметрические | `p`, `t`, `flow`  | Постоянный поток измерений (раз в N сек), значение — число |
| Семантические   | `noise`, `air`, `detector`, `fiber` | Только при срабатывании edge-детектора (порог / классификатор), payload содержит категорию или превышение |

Телеметрические подходят под наш `flow_executor` напрямую (`value: float`).
Семантические — пока модель `SensorReading` принимает только число, в
качестве `value` используем `concentration` (air), `current_value` (noise
threshold) или `confidence` (detector / fiber). Поддержка полной
категориальной модели — в [../../BACKLOG.md](../../BACKLOG.md) §«Приёмник событий СИГМЫ».

## Как добавить новый тип

1. Расширить `SensorType` literal в [backend/app/schemas/domain.py](../../backend/app/schemas/domain.py) (+ frontend-mirror в `api.ts` и `schemas.ts`).
2. Прописать визуальные атрибуты в `SENSOR_TYPE_META` и иконку в `SENSOR_TYPE_ICON` ([frontend/src/components/flow/nodes/index.tsx](../../frontend/src/components/flow/nodes/index.tsx)).
3. Добавить опцию в селект PropertyPanel + пресеты значений в ExecutePanel.
4. Создать здесь новую папку `<type>/` с `README.md` и парой `.json`-сэмплов.
5. Дополнить пресет «Норма / Внимание / Критика» в [ExecutePanel.tsx](../../frontend/src/components/flow/ExecutePanel.tsx).

## Как добавить новый сэмпл (без нового типа)

1. Положить `.json` в подходящую папку `sensors/<type>/`.
2. Файл должен валидироваться против [../schema.json](../schema.json).
3. Имя файла — kebab-case, описательное: `pressure-drop-on-supply.json`.
4. Дописать строку в `<type>/README.md` в таблицу примеров.

## Соглашение по `payload`

- Координаты (если есть): `x`, `y` в условной плоскости объекта (метры
  относительно нулевой точки сети или схемы помещения). Долгота/широта
  не используем — у каждой сети своя локальная карта.
- Числовые измерения — в единицах, указанных в `<type>/README.md`.
- Опциональные поля — `confidence` (0..1), `source_id` (UUID источника
  СИГМЫ — см. .env генератора), `external_id` (текстовый идентификатор
  устройства, например `edge_1`).

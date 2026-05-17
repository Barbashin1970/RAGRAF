# Видеодетектор (`detector`)

CCTV-камера + ML-детектор объектов. На стороне СИГМЫ данные **уже
индексируются в PostgreSQL** — отдельный генератор событий не нужен,
RAGRAF подключается к БД (или к API поверх неё). Исходные ORM-модели
лежат в [../../videodetectors/](../../videodetectors/) — это полные
SQLAlchemy-схемы продакшна.

## Два детектора, две таблицы

### `person` — детектор человека
ORM: [EventPerson](../../videodetectors/person_postgresql.py).
Богатая «персонная карта»: **76+ float-полей** с вероятностями ML-модели:
пол, возрастные группы, одежда (тип, цвет, рукав), обувь, головной убор,
причёска, телосложение, ракурс, татуировка, аксессуары.

Полный список атрибутов: см. ORM-файл. Опорные группы:
- **Биометрия**: `male/female`, возрастные классы `age_0_9..age_50_plus`, `ectomorph/mesomorph/endomorph`, `haircut_*`, `tattoo`
- **Одежда верха**: `top_jacket/coat/vest/hoodie/tshirt/shirt/dress/blazer` + цвет (`top_red/blue/black/…`) + рукав (`sleeve_long/short`)
- **Одежда низа**: `bottom_trousers/skirt/shorts` + цвет (`bottom_*`)
- **Обувь**: `shoes_dark/light`
- **Головной убор**: `hat_cap/baseball/hood/scarf/hat/dark/light`
- **Аксессуары**: `glasses`, `headphones`, `bag_backpack/shoulder/hand`
- **Ракурс**: `view_front/back/side`, `full_visible`

### `anpr` — детектор номеров (ГРЗ)
ORM: [EventNumberPlate](../../videodetectors/grz_postgresql.py).
Чтение государственных регистрационных знаков + распознавание авто:
`numberPlate` (string), `vehicleTypeId`, `color`, `brand`, `model`,
`direction`. Плюс общая обвязка детектора (camera_id, bbox, track_id,
confidence, base64-кадра).

## Общая обвязка (обе таблицы)

| Поле          | Тип   | Описание                                                |
|---------------|-------|---------------------------------------------------------|
| `index`       | UUID  | Первичный ключ записи                                    |
| `event_type`  | text  | Тип события — `person` / `anpr` / …                      |
| `camera_id`   | text  | Идентификатор камеры (произвольная строка)                |
| `camera_name` | text  | Человекочитаемое имя камеры                              |
| `timestamp`   | int64 | Unix-timestamp срабатывания                              |
| `image_path`  | text  | Путь к полному кадру на диске                            |
| `image_base64`| text  | Кадр в base64 (только для `person`)                      |
| `box_image_path`| text| Кадр с нарисованным bbox                                 |
| `confidence`  | float | Уверенность детектора объекта                             |
| `class_id`    | int   | Класс из выходной модели детектора                        |
| `track_id`    | int   | Идентификатор трекинга через кадры                       |
| `bbox`        | text  | Координаты bbox: `x1,y1,x2,y2` в пикселях                |

Координат `x, y` в **метрах мирового пространства нет** — только bbox в
пикселях кадра. Если регламент требует мировой координаты, нужна
гомография на стороне приёмника (`camera_id` → трансформ).

## Маппинг в SIGMA-event формат

Когда RAGRAF будет читать из PostgreSQL, ORM-строка переводится в наш
универсальный контракт `{description, timestamp, payload}`. Шаблон:

```json
{
  "description": "Обнаружен человек на Camera-3",
  "timestamp": "2026-05-17T08:42:11Z",
  "payload": {
    "event_type": "person",
    "camera_id": "Camera-3",
    "camera_name": "Парковка, въезд",
    "track_id": 12345,
    "confidence": 0.93,
    "bbox": "412,256,698,521",
    "image_path": "/images/cam03/...",
    "attributes": { /* top-N атрибутов */ }
  }
}
```

В `attributes` кладём **только top-N сработавших атрибутов** (порог 0.5 +
выбор аргмакса по группам), а не все 76 float'ов — иначе payload станет
неподъёмным. Юзер регламента работает с человекочитаемыми категориями
(`top_clothing: "jacket"`, `top_color: "blue"`), а не с probability-distributions.

## Примеры (формат SIGMA-event, готовый к приёмнику)

| Файл                                          | Что моделирует                                             |
|-----------------------------------------------|-----------------------------------------------------------|
| [person-detection.json](person-detection.json) | Строка из `person` таблицы: человек в синей куртке, возраст 17–35, обнаружен на Camera-3 |
| [vehicle-anpr.json](vehicle-anpr.json)        | Строка из `anpr` таблицы: Toyota Corolla, ГРЗ A123BC777, движение «въезд» |
| [trash-bin-full.json](trash-bin-full.json)    | Из mock-генератора (videodetectors/generator.py): переполненный мусорный бак |

## Mock-генератор

[../../videodetectors/generator.py](../../videodetectors/generator.py) —
скрипт, который пишет случайные события в Postgres-таблицу `events` (не
ORM-схема выше, а упрощённая `events(event_type INT, camera_id INT,
timestamp, object_info JSON, image_url)`). Используется для нагрузочного
тестирования и демо. **Не реальная схема продакшна.** Сохраняется в репо
для понимания тестового стенда.

Типы событий генератора: `1=person`, `2=vehicle`, `3=trash_bin`. Структура
`object_info` для каждого — в коде. Бак — единственная категория,
которой нет в ORM (мусорный бак ≠ детектор объекта, это IoT-уровень).

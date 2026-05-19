"""DuckDB-store для паспортов прикладных модулей (СИГМА § 7).

«Прикладной модуль» — внешний источник событий с формальным контрактом
интеграции. Хранится в таблице `modules` (schema создаётся в
regulation_store._init_schema). Sensor_subtypes связываются с модулем
через FK module_id.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.schemas.domain import Module, ModuleApiContract, ModuleQualityRules
from app.services import regulation_store


def _row_to_module(row: tuple) -> Module:
    """Конвертер DuckDB-row в Module pydantic."""
    api_contract_json = row[9]
    quality_rules_json = row[10]
    event_types_json = row[11]
    api_contract = ModuleApiContract.model_validate(
        json.loads(api_contract_json) if isinstance(api_contract_json, str) else (api_contract_json or {})
    )
    quality_rules = ModuleQualityRules.model_validate(
        json.loads(quality_rules_json) if isinstance(quality_rules_json, str) else (quality_rules_json or {})
    )
    event_types = (
        json.loads(event_types_json) if isinstance(event_types_json, str) else (event_types_json or [])
    )
    return Module(
        id=row[0],
        name=row[1],
        purpose=row[2] or "",
        owner=row[3],
        domain=row[4],
        status=row[5] or "draft",  # type: ignore[arg-type]
        version=row[6] or "1.0",
        icon=row[7],
        color=row[8],
        api_contract=api_contract,
        quality_rules=quality_rules,
        event_types=event_types,
        contact_email=row[12],
        documentation_url=row[13],
        notes=row[14],
    )


_SELECT_COLS = (
    "id, name, purpose, owner, domain, status, version, icon, color, "
    "api_contract, quality_rules, event_types, contact_email, documentation_url, notes"
)


def list_all() -> list[Module]:
    """Все модули, отсортированные по domain + name."""
    with regulation_store._LOCK:
        c = regulation_store._connection()
        rows = c.execute(
            f"SELECT {_SELECT_COLS} FROM modules ORDER BY domain NULLS LAST, name"
        ).fetchall()
    return [_row_to_module(r) for r in rows]


def get(module_id: str) -> Module | None:
    with regulation_store._LOCK:
        c = regulation_store._connection()
        row = c.execute(
            f"SELECT {_SELECT_COLS} FROM modules WHERE id = ?",
            [module_id],
        ).fetchone()
    return _row_to_module(row) if row else None


def save(module: Module) -> Module:
    """UPSERT модуля. Обновляет updated_at автоматически."""
    now = datetime.now(timezone.utc)
    payload = [
        module.id, module.name, module.purpose, module.owner, module.domain,
        module.status, module.version, module.icon, module.color,
        json.dumps(module.api_contract.model_dump(), ensure_ascii=False),
        json.dumps(module.quality_rules.model_dump(), ensure_ascii=False),
        json.dumps(module.event_types, ensure_ascii=False),
        module.contact_email, module.documentation_url, module.notes,
        now,
    ]
    with regulation_store._LOCK:
        c = regulation_store._connection()
        c.execute(
            """
            INSERT INTO modules (
                id, name, purpose, owner, domain, status, version, icon, color,
                api_contract, quality_rules, event_types,
                contact_email, documentation_url, notes, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                purpose = EXCLUDED.purpose,
                owner = EXCLUDED.owner,
                domain = EXCLUDED.domain,
                status = EXCLUDED.status,
                version = EXCLUDED.version,
                icon = EXCLUDED.icon,
                color = EXCLUDED.color,
                api_contract = EXCLUDED.api_contract,
                quality_rules = EXCLUDED.quality_rules,
                event_types = EXCLUDED.event_types,
                contact_email = EXCLUDED.contact_email,
                documentation_url = EXCLUDED.documentation_url,
                notes = EXCLUDED.notes,
                updated_at = EXCLUDED.updated_at
            """,
            payload,
        )
    return module


def delete(module_id: str) -> bool:
    with regulation_store._LOCK:
        c = regulation_store._connection()
        existed = c.execute("SELECT 1 FROM modules WHERE id = ?", [module_id]).fetchone() is not None
        if not existed:
            return False
        c.execute("DELETE FROM modules WHERE id = ?", [module_id])
    return True


def count_sensors_per_module() -> dict[str, int]:
    """Сколько sensor_subtypes привязано к каждому модулю — для UI-бэйджа."""
    with regulation_store._LOCK:
        c = regulation_store._connection()
        try:
            rows = c.execute(
                """
                SELECT module_id, COUNT(*) AS n FROM sensor_subtypes
                WHERE module_id IS NOT NULL
                GROUP BY module_id
                """
            ).fetchall()
        except Exception:
            return {}
    return {r[0]: int(r[1]) for r in rows}


def seed_if_empty() -> None:
    """Засеять стартовый набор модулей при пустой таблице.

    Примеры из § 5 СИГМА «Прикладные модули и внешние источники» +
    реальные модули НГУ-кампуса.
    """
    with regulation_store._LOCK:
        c = regulation_store._connection()
        n = c.execute("SELECT COUNT(*) FROM modules").fetchone()[0]
        if n:
            return

    seeds: list[Module] = [
        # ── Из § 5 СИГМА ──
        Module(
            id="heating-network",
            name="Энергетика и распределительные сети умного города (теплоснабжение)",
            purpose=(
                "КПО для интеллектуального анализа состояния и процессов сетей теплоснабжения, "
                "сопровождение цифровых двойников систем теплоснабжения. Теплогидравлические "
                "расчёты, реконструкция состояний сети по ML-моделям, детектирование аномалий "
                "и идентификация аварийных участков."
            ),
            owner="ЦИИ НГУ (Центр искусственного интеллекта НГУ)",
            domain="heating",
            status="piloting",
            icon="energy",
            color="orange",
            api_contract=ModuleApiContract(
                channel="rest", event_format="json", auth_type="oauth2",
                notes=(
                    "RESTful HTTP API (GET/POST/PUT/PATCH/DELETE), JSON в телах запросов, "
                    "application/octet-stream для бинарных данных. Эндпоинты: "
                    "/api/v1/net_graphs/current-graph-representation, /api/v1/net_graphs/baselines, "
                    "/api/v1/state_prediction/predict-charts, /api/v1/resource_loader/dataset-groups, "
                    "/api/v1/datasets/networks, /api/v1/auth/login. Для длительных расчётов — "
                    "request-polling (в перспективе web-socket)."
                ),
            ),
            quality_rules=ModuleQualityRules(
                completeness="≥ 99% обязательных полей",
                max_latency_seconds=60,
                max_error_rate_percent=0.5,
            ),
            event_types=[
                "telemetry.pressure",
                "telemetry.temperature",
                "telemetry.flow",
                "state.reconstruction",
                "alert.anomaly_detected",
                "alert.emergency_segment",
            ],
            notes=(
                "Архитектура: клиент-серверное веб-приложение, монолит с модульным разделением. "
                "Стек: React (frontend), Python/FastAPI + JWT (IAM, рабочие пространства, сервис данных), "
                "Python/NumPy/SciPy (ядро численного моделирования — теплогидравлика), "
                "Python/PyTorch/TorchGeometric (ML-Service — реконструкция состояний, аномалии, "
                "аварийные участки), PostgreSQL (топология сетей, метаданные, пользователи). "
                "Файловое хранилище в перспективе — MinIO/S3 (артефакты ML-моделей, обучающие "
                "выборки, результаты объёмных расчётов). Мониторинг (в перспективе): Grafana/Prometheus. "
                "Развёртывание: Docker Compose; в перспективе Kubernetes. Гибридная модель доступа: "
                "ролевая + атрибутная."
            ),
        ),
        Module(
            id="noise-monitoring",
            name="ШУМ-ИИ — сейсмоакустика и шумовое загрязнение",
            purpose=(
                "Мониторинг сейсмоакустических колебаний и шумового загрязнения в городской "
                "среде. Сбор, обработка и предоставление данных с распределённой сети "
                "сейсмических станций, интеграция с видеопотоками, выдача типизированных "
                "событий для фреймворка СИГМА."
            ),
            owner="Городское управление экологии",
            domain="environment",
            status="piloting",
            icon="monitoring",
            color="emerald",
            api_contract=ModuleApiContract(
                channel="rest", event_format="json", auth_type="api_key",
                notes=(
                    "Seismic Data Hub — REST-подобное API. Форматы ответа: JSON, ZIP, бинарный. "
                    "Эндпоинты: список станций, список каналов, исторические данные, данные "
                    "«почти реального времени». Источники данных подключаются по протоколам "
                    "SeedLink, Telnet, FTP."
                ),
            ),
            event_types=[
                "telemetry.noise_db",
                "alert.noise_exceed",
                "event.heavy_transport",
            ],
            notes=(
                "Источники данных: сейсмические станции Baykal-8 (несколько независимых каналов "
                "измерений: CH0–CH5). Узлы хранения: вычислительные машины с утилитой slinktool, "
                "формат записи SDS, автоматический перезапуск при обрыве соединения. "
                "Конвертация форматов MiniSEED ↔ PC-A; объединение и временная обрезка "
                "сейсмограмм. Веб-сервисы: буферизация потоковых данных, спектральный анализ "
                "(октавные/третьоктавные спектры, «мозговые волны»), синхронизация с "
                "видеопотоками HLS/WebRTC. Объяснимость — детерминированные алгоритмы "
                "спектрального анализа (БПФ с фиксированными параметрами), без ML «чёрных "
                "ящиков» в базовой логике детекции."
            ),
        ),
        Module(
            id="air-quality",
            name="Мониторинг качества воздуха",
            purpose="Показатели качества воздуха (PM2.5, PM10, NO2, CO2), события превышений ПДК, "
                    "сводки по зонам и времени.",
            owner="Городское управление экологии",
            domain="environment",
            status="production",
            icon="environment",
            color="emerald",
            api_contract=ModuleApiContract(channel="rest", event_format="json", auth_type="api_key"),
            quality_rules=ModuleQualityRules(max_latency_seconds=120),
            event_types=["telemetry.air_quality", "alert.pdk_exceed"],
        ),
        Module(
            id="traffic-management",
            name="Дорожная ситуация",
            purpose="Дорожные события: заторы, инциденты, ограничения движения; "
                    "аналитика транспортной обстановки.",
            owner="ЦОДД",
            domain="safety",
            status="piloting",
            icon="traffic",
            color="amber",
            api_contract=ModuleApiContract(channel="queue", event_format="json", auth_type="oauth2"),
            event_types=["traffic.congestion", "traffic.incident", "traffic.restriction"],
        ),
        Module(
            id="das-fiber-monitoring",
            name="Умные оптоволоконные датчики для городской инфраструктуры (DAS)",
            purpose=(
                "Программный комплекс обработки, анализа и интерпретации данных от "
                "распределённого оптоволоконного датчика при мониторинге объектов городской "
                "инфраструктуры. Бинарная классификация событий контроля периметра: "
                "«шаг человека», «копка человеком», «шумовое событие»."
            ),
            owner="АО «Дунай-Связь» / ЦИИНГУ",
            domain="safety",
            status="piloting",
            icon="surveillance",
            color="violet",
            api_contract=ModuleApiContract(
                channel="webhook", event_format="json", auth_type="mtls",
            ),
            quality_rules=ModuleQualityRules(),
            event_types=[
                "das.step_human",
                "das.digging_human",
                "das.noise_event",
            ],
            notes=(
                "Модульная структура: Data Preprocessing, Model Training (Encoder/Decoder/"
                "Classifier + остаточные блоки, PCAWithLogisticRegression — модель "
                "предварительной фильтрации), Quality Analysis, Performance Analysis, "
                "Data Analysis. Обучение с частичным привлечением учителя (SSLAE), "
                "оптимизация гиперпараметров через Optuna. Стек: Python, PyTorch, "
                "TorchMetrics, Pandas, Matplotlib, Seaborn, scikit-learn (PCA, "
                "LogisticRegression). Метрики качества: Accuracy, Precision, F1-score, "
                "Recall, ROC AUC, плюс PSNR и MSE для оценки реконструкции автокодировщика. "
                "Объяснимость: визуализация ложноположительных/ложноотрицательных "
                "классификаций (особенности сигнала и реконструированного изображения)."
            ),
        ),
        Module(
            id="medical-imaging-diagnostics",
            name="ИИ-диагностика социально-значимых заболеваний (МРТ, рентген)",
            purpose=(
                "Дистанционная и ранняя диагностика, динамический мониторинг по данным "
                "медицинской визуализации: сегментация поражений головного мозга по МРТ "
                "(T1, T1 с контрастом, T2, T2-FLAIR), классификация туберкулёза лёгких "
                "по рентгенограммам."
            ),
            owner="Региональный Минздрав",
            domain="emergency_response",
            status="draft",
            icon="healthcare",
            color="rose",
            api_contract=ModuleApiContract(
                channel="rest", event_format="json", auth_type="oauth2",
                notes=(
                    "REST API + очереди сообщений (RabbitMQ/Redis), отчёты JSON/XML. "
                    "На входе деперсонализированные DICOM 3.0 и NIfTI. Интеграция с "
                    "внешними МИС/РИС/ЕМИАС через HL7/DICOM. ПДн → 152-ФЗ, ИСПДн-"
                    "аттестованный контур."
                ),
            ),
            quality_rules=ModuleQualityRules(
                max_latency_seconds=300,  # < 5 мин на пациента (4 серии, 600 срезов) по ТЗ
            ),
            event_types=[
                "diagnostics.mri_brain_segmentation",
                "diagnostics.tuberculosis_classification",
                "diagnostics.report_ready",
                "diagnostics.image_quality_warning",
            ],
            notes=(
                "Целевые показатели по ТЗ: AUC-ROC > 0.85 для детекции патологий МРТ, "
                "Dice > 0.80 для сегментации опухолей ГМ, AUC-ROC > 0.90 для туберкулёза, "
                "чувствительность/специфичность > 0.85 / > 0.90. Архитектуры: U-Net, "
                "nnU-Net (МРТ), EfficientNet/ResNet (рентген). Стек: Python 3.10+, "
                "PyTorch, TensorFlow, MONAI, FastAI, pydicom, NiBabel, SimpleITK, OpenCV, "
                "SciPy, NumPy, Pandas, CUDA 11.8+, TorchMetrics, Scikit-learn, Matplotlib, "
                "Plotly. Хранение: PostgreSQL + SQLAlchemy + Pydantic (метаданные), "
                "MinIO/S3 (сырые/размеченные данные, маски, чекпоинты), MLflow, NFS "
                "(бэкапы). Мониторинг: GPUtil, Prometheus + Grafana. Оркестрация: Docker, "
                "Kubernetes (опционально), RabbitMQ/Redis. Гибридное развёртывание — "
                "облако или on-premise контур медучреждения. Три режима: базовый "
                "(визуализация), экспертный (аннотирование), потоковый (пакетная обработка). "
                "Автоматическая деперсонализация ПДн; ролевой доступ (врач/администратор/"
                "эксперт-исследователь)."
            ),
        ),
        Module(
            id="urban-health-impact-assessment",
            name="Персонализированная оценка воздействия городской среды на здоровье",
            purpose=(
                "Формирование персонализированного перечня диагностических и "
                "профилактических мероприятий на основе оценки индивидуальных рисков с "
                "учётом экологических факторов городской среды. Ранжированный список "
                "заболеваний с оценками вероятности развития в заданный временной горизонт."
            ),
            owner="Региональный Минздрав",
            domain="emergency_response",
            status="draft",
            icon="healthcare",
            color="rose",
            api_contract=ModuleApiContract(
                channel="rest", event_format="json", auth_type="oauth2",
                notes=(
                    "Уровень представления — REST API + пользовательские интерфейсы + "
                    "визуализация. Модуль интеграции с СИГМОЙ генерирует события для "
                    "ядра. Экспорт отчётов: PDF, XLSX, JSON. ПДн → 152-ФЗ."
                ),
            ),
            event_types=[
                "health.risk_assessment",
                "health.lab_priority_recommendation",
                "health.prophylactic_recommendation",
            ],
            notes=(
                "Архитектура: распределённая интеллектуальная система. Модули — обучения, "
                "приоритизации, аналитики, интеграции с СИГМОЙ. Уровень данных и знаний: "
                "(1) векторное хранилище эмбеддингов концептов; (2) база знаний — граф "
                "знаний (онтология заболеваний/симптомов/лабораторных показателей/"
                "экологических факторов/патогенетических механизмов + извлечённые связи); "
                "(3) реляционное/аналитическое хранилище статистики (OLAP). Извлечение "
                "знаний: text-mining PubMed/ClinicalTrials.gov/локальных репозиториев, "
                "NER на BioBERT/SciBERT, семантико-лингвистические правила, нормализация "
                "к онтологии через fuzzy-matching и векторную близость. Оценка рисков — "
                "графовые нейронные сети (GNN) над эмбеддингами вершин. Приоритизация "
                "лабораторных исследований — Concrete Autoencoder (стохастический отбор "
                "признаков)."
            ),
        ),
        # ── НГУ-кампус (наши реальные коннекторы) ──
        Module(
            id="nsu-adpi-gsm",
            name="АДПИ GSM пожарные извещатели",
            purpose="Автономные дымовые пожарные извещатели с GSM-связью в социальных объектах "
                    "кампуса НГУ (учебные корпуса, общежития, библиотека).",
            owner="МКУ «СВЕТОЧ» (Кольцово) / Служба ГО НГУ",
            domain="emergency_response",
            status="production",
            icon="fire",
            color="rose",
            api_contract=ModuleApiContract(
                channel="webhook", event_format="json", auth_type="api_key",
            ),
            quality_rules=ModuleQualityRules(
                max_latency_seconds=180,
                max_error_rate_percent=1.0,
            ),
            event_types=["alert.smoke", "alert.heartbeat_lost", "alert.low_battery"],
            notes="Используется как датчик в регламентах nsu-campus-fire-action, "
                  "koltsovo-edds-adpi-monitoring.",
        ),
        Module(
            id="nsu-video-analytics",
            name="Видеоаналитика Нетрис (СКД + распознавание лиц)",
            purpose="Видеоаналитика на камерах кампуса НГУ: распознавание лиц, детекция "
                    "проникновения в зоны с ограничением доступа, детекция оставленных предметов.",
            owner="ИВЦ НГУ + Нетрис",
            domain="safety",
            status="piloting",
            icon="surveillance",
            color="rose",
            api_contract=ModuleApiContract(
                channel="rest", event_format="json", auth_type="api_key",
            ),
            event_types=["video.face_recognized", "video.intrusion", "video.left_object"],
            notes="Используется в nsu-campus-access-control + nsu-campus-antiterrorism.",
        ),
        Module(
            id="nsu-anpr-parking",
            name="ANPR-система парковки Войслинк",
            purpose="Распознавание номеров автомобилей на въезде/выезде с парковок кампуса НГУ; "
                    "контроль доступа по белому списку, ведение журнала проездов.",
            owner="АХУ НГУ + Войслинк",
            domain="safety",
            status="production",
            icon="cargo",
            color="amber",
            api_contract=ModuleApiContract(channel="rest", event_format="json", auth_type="api_key"),
            event_types=["anpr.plate_recognized", "anpr.plate_unknown", "anpr.barrier_failure"],
            notes="Используется в nsu-parking-anpr.",
        ),
        Module(
            id="nsu-bms-engineering",
            name="BMS / ЦИМ инженерных сетей НГУ",
            purpose="Building Management System кампуса: датчики давления/температуры/расхода "
                    "теплосети, вентиляции, электроснабжения; ЦИМ здания на основе данных СКАДА.",
            owner="Сервисная УК / ИВЦ НГУ",
            domain="campus",
            status="piloting",
            icon="utilities",
            color="indigo",
            api_contract=ModuleApiContract(channel="queue", event_format="json", auth_type="mtls"),
            event_types=["bms.pressure", "bms.temperature", "bms.flow", "bms.power_failure"],
            notes="Используется в nsu-campus-engineering-ops + nsu-campus-situational-center.",
        ),
    ]
    for m in seeds:
        save(m)


# ── Targeted seed для медицинских модулей из пояснительной записки ────
# Эти 2 модуля описаны в «ПОЯСНИТЕЛЬНАЯ ЗАПИСКА — Описание архитектуры»
# (14.04.2026): ИИ-диагностика по МРТ/рентгену и оценка воздействия
# городской среды на здоровье. Раньше был один placeholder `health-services`.
#
# Функция вызывается из миграции seed_arch_pdf_medical_modules_v1 в
# regulation_store, чтобы добавить эти модули в уже-установленные
# инстансы без перезатирания пользовательских правок других модулей.
_MEDICAL_MODULES_FROM_ARCH_PDF: tuple[Module, ...] = (
    Module(
        id="medical-imaging-diagnostics",
        name="ИИ-диагностика социально-значимых заболеваний (МРТ, рентген)",
        purpose=(
            "Дистанционная и ранняя диагностика, динамический мониторинг по данным "
            "медицинской визуализации: сегментация поражений головного мозга по МРТ "
            "(T1, T1 с контрастом, T2, T2-FLAIR), классификация туберкулёза лёгких "
            "по рентгенограммам."
        ),
        owner="Региональный Минздрав",
        domain="emergency_response",
        status="draft",
        icon="healthcare",
        color="rose",
        api_contract=ModuleApiContract(
            channel="rest", event_format="json", auth_type="oauth2",
            notes=(
                "REST API + очереди сообщений (RabbitMQ/Redis), отчёты JSON/XML. "
                "На входе деперсонализированные DICOM 3.0 и NIfTI. Интеграция с "
                "внешними МИС/РИС/ЕМИАС через HL7/DICOM. ПДн → 152-ФЗ, ИСПДн-"
                "аттестованный контур."
            ),
        ),
        quality_rules=ModuleQualityRules(max_latency_seconds=300),
        event_types=[
            "diagnostics.mri_brain_segmentation",
            "diagnostics.tuberculosis_classification",
            "diagnostics.report_ready",
            "diagnostics.image_quality_warning",
        ],
        notes=(
            "Целевые показатели по ТЗ: AUC-ROC > 0.85 для детекции патологий МРТ, "
            "Dice > 0.80 для сегментации опухолей ГМ, AUC-ROC > 0.90 для туберкулёза, "
            "чувствительность/специфичность > 0.85 / > 0.90. Архитектуры: U-Net, "
            "nnU-Net (МРТ), EfficientNet/ResNet (рентген). Стек: Python 3.10+, "
            "PyTorch, TensorFlow, MONAI, FastAI, pydicom, NiBabel, SimpleITK, OpenCV, "
            "SciPy, NumPy, Pandas, CUDA 11.8+, TorchMetrics, Scikit-learn, Matplotlib, "
            "Plotly. Хранение: PostgreSQL + SQLAlchemy + Pydantic, MinIO/S3, MLflow, "
            "NFS (бэкапы). Мониторинг: GPUtil, Prometheus + Grafana. Оркестрация: "
            "Docker, Kubernetes (опционально), RabbitMQ/Redis. Гибридное "
            "развёртывание — облако или on-premise. Три режима: базовый "
            "(визуализация), экспертный (аннотирование), потоковый (пакетная "
            "обработка). Автоматическая деперсонализация ПДн; ролевой доступ."
        ),
    ),
    Module(
        id="urban-health-impact-assessment",
        name="Персонализированная оценка воздействия городской среды на здоровье",
        purpose=(
            "Формирование персонализированного перечня диагностических и "
            "профилактических мероприятий на основе оценки индивидуальных рисков с "
            "учётом экологических факторов городской среды. Ранжированный список "
            "заболеваний с оценками вероятности развития в заданный временной горизонт."
        ),
        owner="Региональный Минздрав",
        domain="emergency_response",
        status="draft",
        icon="healthcare",
        color="rose",
        api_contract=ModuleApiContract(
            channel="rest", event_format="json", auth_type="oauth2",
            notes=(
                "Уровень представления — REST API + пользовательские интерфейсы + "
                "визуализация. Модуль интеграции с СИГМОЙ генерирует события для "
                "ядра. Экспорт отчётов: PDF, XLSX, JSON. ПДн → 152-ФЗ."
            ),
        ),
        event_types=[
            "health.risk_assessment",
            "health.lab_priority_recommendation",
            "health.prophylactic_recommendation",
        ],
        notes=(
            "Архитектура: распределённая интеллектуальная система. Модули — обучения, "
            "приоритизации, аналитики, интеграции с СИГМОЙ. Уровень данных и знаний: "
            "(1) векторное хранилище эмбеддингов концептов; (2) база знаний — граф "
            "знаний (онтология заболеваний/симптомов/лабораторных показателей/"
            "экологических факторов/патогенетических механизмов + извлечённые связи); "
            "(3) реляционное/аналитическое хранилище статистики (OLAP). Извлечение "
            "знаний: text-mining PubMed/ClinicalTrials.gov, NER на BioBERT/SciBERT, "
            "нормализация к онтологии через fuzzy-matching и векторную близость. "
            "Оценка рисков — графовые нейронные сети (GNN). Приоритизация "
            "лабораторных исследований — Concrete Autoencoder."
        ),
    ),
)


def seed_arch_pdf_medical_modules_if_missing() -> None:
    """Аддитивный seed: вставляет 2 медицинских модуля из пояснительной
    записки, если их ещё нет. Пользовательские правки других модулей
    не трогает.
    """
    for m in _MEDICAL_MODULES_FROM_ARCH_PDF:
        if get(m.id) is None:
            save(m)

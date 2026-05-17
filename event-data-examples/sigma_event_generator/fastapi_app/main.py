# fastapi_app/main.py
import os
import logging
from pathlib import Path
import sys

LOG_DIR = Path(os.getenv("LOG_DIR", "/app/logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)

handlers = [logging.StreamHandler(sys.stdout)]
try:
    file_handler = logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8", mode="a")
    file_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
    handlers.append(file_handler)
except Exception as e:
    print(f"⚠️ Не удалось создать файл лога: {e}", file=sys.stderr)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=handlers,
    force=True  # ← перезаписать любую предыдущую конфигурацию
)
logger = logging.getLogger(__name__)
logger.info("🧪 ТЕСТ: Логгер работает! Папка: %s", LOG_DIR)

import json
import random
import asyncio
import httpx
from contextlib import asynccontextmanager

from fastapi import FastAPI
from tritonclient.grpc import InferenceServerClient, InferInput, InferRequestedOutput
import numpy as np


# === Конфигурация ===
TRITON_HOST = os.getenv("TRITON_HOST", "localhost:8001")
TARGET_URL = os.getenv("TARGET_URL", "http://109.202.1.153:8967/api/v1/sources/3cf6f24b-2dda-4657-92af-43cfb42d3c2e/events/")
BASE_INTERVAL_MIN = int(os.getenv("BASE_INTERVAL_MIN", "30"))
JITTER_MIN = int(os.getenv("JITTER_MIN", "5"))

triton_client = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Инициализация и завершение + запуск фоновой задачи"""
    global triton_client
    triton_client = InferenceServerClient(url=TRITON_HOST, verbose=False)
    logger.info(f"✓ Подключён к Triton: {TRITON_HOST}")

    # Запускаем фоновую задачу
    task = asyncio.create_task(_scheduled_event_task())

    yield
    
    task.cancel()

    if triton_client:
        triton_client.close()

    logger.info("🔌 Соединения закрыты")

app = FastAPI(title="Event Generator", lifespan=lifespan)

def _calculate_next_interval():
    """Интервал 30 ± 5 минут в секундах"""
    minutes = BASE_INTERVAL_MIN + random.randint(-JITTER_MIN, JITTER_MIN)
    return minutes * 60

def _call_triton_generate():
    """Вызов Triton модели для генерации события"""
    try:
        # Входной тензор (пустой, т.к. логика внутри модели)
        input0 = InferInput("input", [1], "BYTES")
        input0.set_data_from_numpy(np.array(["generate"], dtype=object))
        
        # Выходной тензор
        output0 = InferRequestedOutput("output")
        
        response = triton_client.infer(
            model_name="event_generator",
            inputs=[input0],
            outputs=[output0],
            client_timeout=30
        )
        
        result = response.as_numpy("output")[0].decode("utf-8")
        return json.loads(result)
    except Exception as e:
        logger.info(f"✗ Ошибка вызова Triton: {e}")
        return None

async def _send_event_to_api(event_data: dict, expected_timestamp: str):
    """Отправка POST запроса с событием"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                TARGET_URL,
                json=event_data,
                headers={
                    "accept": "application/json",
                    "Content-Type": "application/json"
                }
            )
            if resp.status_code in (200, 201, 202):
                logger.info(f"✓ Событие отправлено: {expected_timestamp}")
                return True
            else:
                logger.info(f"✗ HTTP {resp.status_code}: {resp.text}")
                return False
    except Exception as e:
        logger.info(f"✗ Ошибка отправки: {e}")
        return False

async def _scheduled_event_task():
    """Фоновая задача: генерация и отправка событий по расписанию"""
    while True:
        interval = _calculate_next_interval()
        logger.info(f"⏳ Следующее событие через {interval//60} мин ± {JITTER_MIN} мин")
        await asyncio.sleep(interval)
        
        # Генерация через Triton
        result = _call_triton_generate()
        if not result or result.get("status") != "generated":
            logger.info("✗ Не удалось сгенерировать событие")
            continue
        
        event_wrapper = result["event"]  # {"msg": {...}}
        timestamp = result["timestamp"]
        
        # Отправка
        await _send_event_to_api(event_wrapper, timestamp)

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "triton": triton_client.is_server_ready() if triton_client else False,
        "target_url": TARGET_URL,
        "next_event_in_min": f"{BASE_INTERVAL_MIN} ± {JITTER_MIN}"
    }

@app.post("/generate-now")
async def generate_now():
    """Ручной триггер генерации события (для тестов)"""
    result = _call_triton_generate()
    if not result:
        return {"status": "error", "message": "Failed to generate"}
    
    # Отправка
    await _send_event_to_api(result["event"], result["timestamp"])
    return {"status": "sent", "data": result}

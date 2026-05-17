import os
import random
import time
import psycopg2
import json
from datetime import datetime, timedelta
from faker import Faker
from models import Event
from dotenv import load_dotenv

load_dotenv()

fake = Faker()

# Конфигурация
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/events_db')
GENERATOR_INTERVAL = int(os.getenv('GENERATOR_INTERVAL', 5000)) / 100
CAMERA_COUNT = int(os.getenv('CAMERA_COUNT', 50))
IMAGE_STORAGE_PATH = os.getenv('IMAGE_STORAGE_PATH', '/images')

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def init_cameras():
    """Инициализация тестовых камер если их нет"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Проверить есть ли камеры
        cur.execute("SELECT COUNT(*) FROM cameras")
        count = cur.fetchone()[0]
        
        if count == 0:
            # Создать тестовые камеры
            for i in range(1, CAMERA_COUNT + 1):
                cur.execute("""
                    INSERT INTO cameras (name, location, is_active)
                    VALUES (%s, %s, %s)
                """, (
                    f'Camera-{i}',
                    f'Building-{(i % 5) + 1}, Floor-{(i % 3) + 1}',
                    True
                ))
            conn.commit()
            print(f"Created {CAMERA_COUNT} test cameras")
    except Exception as e:
        print(f"Error initializing cameras: {e}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()

def generate_person_info() -> dict:
    """Генерация информации о человеке"""
    clothing_items = {
        'upper': ['red jacket', 'blue shirt', 'black hoodie', 'white t-shirt', 'green sweater'],
        'lower': ['blue jeans', 'black pants', 'khaki shorts', 'gray sweatpants'],
        'footwear': ['sneakers', 'boots', 'sandals', 'loafers']
    }

    return {
        'clothing': {
            'upper': random.choice(clothing_items['upper']),
            'lower': random.choice(clothing_items['lower']),
            'footwear': random.choice(clothing_items['footwear'])
        },
        'estimated_age': f"{random.randint(18, 65)}-{random.randint(18, 65)}",
        'gender': random.choice(['male', 'female'])
    }

def generate_vehicle_info() -> dict:
    """Генерация информации об автомобиле"""
    vehicle_types = ['sedan', 'suv', 'hatchback', 'truck', 'van']
    colors = ['black', 'white', 'silver', 'red', 'blue', 'gray']
    brands = ['Toyota', 'Honda', 'Ford', 'BMW', 'Mercedes', 'Audi', 'Volkswagen']

    return {
        'vehicle_type': random.choice(vehicle_types),
        'license_plate': f"{fake.lexify('???').upper()}{fake.numerify('###')}",
        'color': random.choice(colors),
        'brand': random.choice(brands)
    }

def generate_trash_bin_info() -> dict:
    """Генерация информации о мусорном баке"""
    streets = ['Lenina Street', 'Pushkina Street', 'Gagarina Avenue', 'Kirova Street', 'Soviet Street']

    return {
        'street': random.choice(streets),
        'bin_id': f"TB-{random.randint(1, 100):03d}",
        'fill_level': f"{random.randint(85, 100)}%",
        'coordinates': {
            'lat': 55.7558 + random.uniform(-0.1, 0.1),
            'lon': 37.6173 + random.uniform(-0.1, 0.1)
        }
    }

def generate_event() -> Event:
    """Генерация случайного события"""
    event_type = random.choice([1, 2, 3])
    camera_id = random.randint(1, CAMERA_COUNT)
    timestamp = datetime.now() - timedelta(minutes=random.randint(0, 60))

    if event_type == 1:
        object_info = generate_person_info()
    elif event_type == 2:
        object_info = generate_vehicle_info()
    else:
        object_info = generate_trash_bin_info()

    image_url = f"{IMAGE_STORAGE_PATH}/event_{int(time.time())}_{random.randint(1000, 9999)}.jpg"

    return Event(
        event_type=event_type,
        camera_id=camera_id,
        timestamp=timestamp,
        object_info=object_info,
        image_url=image_url
    )

def save_event_to_db(event: Event):
    """Сохранение события в базу данных"""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        cur.execute("""
            INSERT INTO events (event_type, camera_id, timestamp, object_info, image_url)
            VALUES (%s, %s, %s, %s, %s)
        """, (
            event.event_type,
            event.camera_id,
            event.timestamp,
            json.dumps(event.object_info),
            event.image_url
        ))
        conn.commit()
        print(f"Event saved: type={event.event_type}, camera={event.camera_id}")
    except Exception as e:
        print(f"Error saving event: {e}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()

def main():
    """Основной цикл генератора"""
    print(f"Starting event generator (interval: {GENERATOR_INTERVAL}s)")
    
    # Инициализировать камеры
    init_cameras()

    while True:
        try:
            event = generate_event()
            save_event_to_db(event)
            time.sleep(GENERATOR_INTERVAL)
        except KeyboardInterrupt:
            print("Generator stopped by user")
            break
        except Exception as e:
            print(f"Error in generator: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()

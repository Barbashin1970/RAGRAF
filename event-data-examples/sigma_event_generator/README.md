# Sigma Event Generator

Генерация событий через Triton → отправка на внешний API.

## 🚀 Запуск

```bash
# 1. Создать .env (если нет)
cp .env.example .env  # или создайте вручную

# 2. Запустить
docker compose up -d

# 3. Проверить
curl http://localhost:8080/health

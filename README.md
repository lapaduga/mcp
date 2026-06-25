# MCP Tools Hub

MCP-сервер с веб-интерфейсом для просмотра и вызова инструментов через REST API.

## Быстрый старт

```bash
# Установка зависимостей
npm install

# Запуск сервера
npm start
```

Откройте http://localhost:3000 в браузере.

## Переменные окружения

Скопируйте `.env.example` в `.env`:

```bash
cp .env.example .env
```

| Переменная | По умолчанию | Описание |
|-----------|-------------|---------|
| PORT | 3000 | Порт Express-сервера |
| LOG_LEVEL | info | Уровень логирования (debug, info, warn, error) |
| MCP_TRANSPORT | sse | Предпочтительный транспорт (stdio, sse) |

## Тестирование

```bash
npm test
```

## Архитектура

Проект построен по модульному принципу:

- `src/mcp/tools/` — каждый инструмент в отдельном файле. Чтобы добавить новый, создайте файл с экспортами `name`, `description`, `inputSchema`, `handler`.
- `src/mcp/tools/registry.js` — автоматически загружает инструменты из папки `tools/`.
- `src/mcp/server.js` — инициализация MCP-сервера.
- `src/api/routes.js` — REST API для браузерного UI.
- `src/public/` — фронтенд на Vanilla JS.

## API Endpoints

- `GET /api/health` — проверка работы сервера
- `GET /api/tools` — список доступных инструментов
- `POST /api/tools/:name/call` — вызов инструмента
- `GET /mcp/sse` — SSE транспорт для MCP-клиентов
- `POST /mcp/message` — приём сообщений MCP

# Poker Club API Server для Railway

## Быстрый старт

1. Создайте новый проект на Railway.app
2. Подключите этот репозиторий
3. Railway автоматически развернёт сервер

## Переменные окружения

Не требуются - сервер работает из коробки!

## После развёртывания

Railway даст вам URL вида: `https://your-app.railway.app`

Используйте этот URL в вашем Telegram Mini App:
```javascript
const API_BASE = 'https://your-app.railway.app/api';
```

## Endpoints

- `GET /` - Проверка работы сервера
- `GET /api/users` - Получить всех пользователей
- `GET /api/users/telegram/:telegramId` - Получить пользователя
- `POST /api/users` - Создать пользователя
- `PUT /api/users/:id` - Обновить пользователя
- `GET /api/tournaments` - Получить турниры
- `POST /api/tournaments` - Создать турнир
- `POST /api/tournaments/:id/join` - Присоединиться к турниру
- `PUT /api/tournaments/:id/status` - Обновить статус турнира
- `GET /api/admin/stats` - Статистика

# 🎲 Poker Club API Server

## 🚀 Развёрнуто на Render с PostgreSQL

Этот сервер использует PostgreSQL для постоянного хранения данных.

### ✅ Особенности:
- **PostgreSQL база данных** - данные никогда не теряются
- **RESTful API** для управления пользователями и турнирами
- **CORS** настроен для работы с Telegram Mini App
- **Автоматическая инициализация** таблиц базы данных

### 📡 API Endpoints:

#### Пользователи:
- `GET /api/users` - Получить всех пользователей
- `GET /api/users/telegram/:telegramId` - Получить пользователя по Telegram ID
- `POST /api/users` - Создать нового пользователя
- `PUT /api/users/:id` - Обновить пользователя

#### Турниры:
- `GET /api/tournaments` - Получить все турниры
- `POST /api/tournaments` - Создать турнир
- `POST /api/tournaments/:id/join` - Присоединиться к турниру
- `PUT /api/tournaments/:id/status` - Обновить статус турнира

#### Статистика:
- `GET /api/admin/stats` - Получить общую статистику

### 🔧 Переменные окружения:
- `DATABASE_URL` - URL подключения к PostgreSQL
- `PORT` - Порт сервера (по умолчанию 3000)

### 📦 Зависимости:
- `express` - Web framework
- `cors` - CORS middleware
- `pg` - PostgreSQL client

---

**Сервер запущен и готов к использованию!** ✅


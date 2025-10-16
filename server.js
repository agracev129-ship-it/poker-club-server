const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// PostgreSQL подключение
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Инициализация базы данных
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                telegram_name TEXT,
                telegram_username TEXT,
                game_nickname TEXT UNIQUE NOT NULL,
                preferred_game TEXT,
                avatar TEXT DEFAULT '👤',
                telegram_avatar_url TEXT,
                total_wins INTEGER DEFAULT 0,
                total_games INTEGER DEFAULT 0,
                points INTEGER DEFAULT 0,
                registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tournaments (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                date TIMESTAMP NOT NULL,
                duration INTEGER DEFAULT 2,
                max_players INTEGER NOT NULL,
                prize INTEGER NOT NULL,
                status TEXT DEFAULT 'upcoming',
                type TEXT DEFAULT 'texas_holdem',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tournament_participants (
                id SERIAL PRIMARY KEY,
                tournament_id INTEGER REFERENCES tournaments(id),
                user_id INTEGER REFERENCES users(id),
                join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ База данных инициализирована');
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error);
    }
}

initDatabase();

// API Routes

// Получить всех пользователей
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users ORDER BY points DESC');
        const users = result.rows.map(row => ({
            id: row.id,
            telegramId: row.telegram_id,
            telegramName: row.telegram_name,
            telegramUsername: row.telegram_username,
            gameNickname: row.game_nickname,
            preferredGame: row.preferred_game,
            avatar: row.avatar,
            telegramAvatarUrl: row.telegram_avatar_url,
            stats: {
                totalWins: row.total_wins,
                totalGames: row.total_games,
                points: row.points,
                currentRank: 1
            },
            registrationDate: row.registration_date
        }));
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить пользователя по Telegram ID
app.get('/api/users/telegram/:telegramId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [req.params.telegramId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }
        const row = result.rows[0];
        const user = {
            id: row.id,
            telegramId: row.telegram_id,
            telegramName: row.telegram_name,
            telegramUsername: row.telegram_username,
            gameNickname: row.game_nickname,
            preferredGame: row.preferred_game,
            avatar: row.avatar,
            telegramAvatarUrl: row.telegram_avatar_url,
            stats: {
                totalWins: row.total_wins,
                totalGames: row.total_games,
                points: row.points,
                currentRank: 1
            },
            registrationDate: row.registration_date
        };
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Создать пользователя
app.post('/api/users', async (req, res) => {
    try {
        const { telegramId, telegramName, telegramUsername, gameNickname, preferredGame, avatar, telegramAvatarUrl } = req.body;
        
        // Проверяем уникальность
        const existing = await pool.query('SELECT * FROM users WHERE telegram_id = $1 OR game_nickname = $2', [telegramId, gameNickname]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким Telegram ID или никнеймом уже существует' });
        }
        
        const result = await pool.query(
            'INSERT INTO users (telegram_id, telegram_name, telegram_username, game_nickname, preferred_game, avatar, telegram_avatar_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [telegramId, telegramName, telegramUsername, gameNickname, preferredGame, avatar || '👤', telegramAvatarUrl]
        );
        
        const row = result.rows[0];
        const user = {
            id: row.id,
            telegramId: row.telegram_id,
            telegramName: row.telegram_name,
            telegramUsername: row.telegram_username,
            gameNickname: row.game_nickname,
            preferredGame: row.preferred_game,
            avatar: row.avatar,
            telegramAvatarUrl: row.telegram_avatar_url,
            stats: {
                totalWins: row.total_wins,
                totalGames: row.total_games,
                points: row.points,
                currentRank: 1
            },
            registrationDate: row.registration_date
        };
        
        res.status(201).json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновить пользователя
app.put('/api/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const { gameNickname, preferredGame, avatar, telegramAvatarUrl, stats, telegramName, telegramUsername } = req.body;
        
        let updates = [];
        let values = [];
        let paramIndex = 1;
        
        if (gameNickname) { updates.push(`game_nickname = $${paramIndex++}`); values.push(gameNickname); }
        if (preferredGame) { updates.push(`preferred_game = $${paramIndex++}`); values.push(preferredGame); }
        if (avatar) { updates.push(`avatar = $${paramIndex++}`); values.push(avatar); }
        if (telegramAvatarUrl) { updates.push(`telegram_avatar_url = $${paramIndex++}`); values.push(telegramAvatarUrl); }
        if (telegramName) { updates.push(`telegram_name = $${paramIndex++}`); values.push(telegramName); }
        if (telegramUsername) { updates.push(`telegram_username = $${paramIndex++}`); values.push(telegramUsername); }
        if (stats) {
            if (stats.totalWins !== undefined) { updates.push(`total_wins = $${paramIndex++}`); values.push(stats.totalWins); }
            if (stats.totalGames !== undefined) { updates.push(`total_games = $${paramIndex++}`); values.push(stats.totalGames); }
            if (stats.points !== undefined) { updates.push(`points = $${paramIndex++}`); values.push(stats.points); }
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ message: 'Нет данных для обновления' });
        }
        
        values.push(userId);
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }
        
        const row = result.rows[0];
        const user = {
            id: row.id,
            telegramId: row.telegram_id,
            telegramName: row.telegram_name,
            telegramUsername: row.telegram_username,
            gameNickname: row.game_nickname,
            preferredGame: row.preferred_game,
            avatar: row.avatar,
            telegramAvatarUrl: row.telegram_avatar_url,
            stats: {
                totalWins: row.total_wins,
                totalGames: row.total_games,
                points: row.points,
                currentRank: 1
            },
            registrationDate: row.registration_date
        };
        
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить все турниры
app.get('/api/tournaments', async (req, res) => {
    try {
        const tournamentsResult = await pool.query('SELECT * FROM tournaments ORDER BY date ASC');
        
        const tournaments = await Promise.all(tournamentsResult.rows.map(async (tournament) => {
            const participantsResult = await pool.query(
                `SELECT u.id, u.telegram_id, u.game_nickname, u.avatar, u.telegram_avatar_url, tp.join_date 
                 FROM tournament_participants tp 
                 JOIN users u ON tp.user_id = u.id 
                 WHERE tp.tournament_id = $1`,
                [tournament.id]
            );
            
            const participants = participantsResult.rows.map(p => ({
                id: p.id,
                telegramId: p.telegram_id,
                nickname: p.game_nickname,
                avatar: p.avatar,
                telegramAvatarUrl: p.telegram_avatar_url,
                joinDate: p.join_date
            }));
            
            return {
                ...tournament,
                participants
            };
        }));
        
        res.json(tournaments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Создать турнир
app.post('/api/tournaments', async (req, res) => {
    try {
        const { name, date, duration, maxPlayers, prize, type } = req.body;
        
        const result = await pool.query(
            'INSERT INTO tournaments (name, date, duration, max_players, prize, type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, date, duration, maxPlayers, prize, type]
        );
        
        const tournament = {
            ...result.rows[0],
            participants: []
        };
        
        res.status(201).json(tournament);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Присоединиться к турниру
app.post('/api/tournaments/:tournamentId/join', async (req, res) => {
    try {
        const { tournamentId } = req.params;
        const { userId } = req.body;
        
        // Проверяем, не участвует ли уже
        const existing = await pool.query(
            'SELECT * FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2',
            [tournamentId, userId]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Вы уже участвуете в этом турнире' });
        }
        
        // Проверяем заполненность
        const countResult = await pool.query(
            'SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = $1',
            [tournamentId]
        );
        
        const tournamentResult = await pool.query('SELECT max_players FROM tournaments WHERE id = $1', [tournamentId]);
        
        if (tournamentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Турнир не найден' });
        }
        
        if (parseInt(countResult.rows[0].count) >= tournamentResult.rows[0].max_players) {
            return res.status(400).json({ error: 'Турнир заполнен' });
        }
        
        // Добавляем участника
        await pool.query(
            'INSERT INTO tournament_participants (tournament_id, user_id) VALUES ($1, $2)',
            [tournamentId, userId]
        );
        
        res.json({ message: 'Вы присоединились к турниру' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновить статус турнира
app.put('/api/tournaments/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        await pool.query('UPDATE tournaments SET status = $1 WHERE id = $2', [status, id]);
        
        res.json({ message: `Статус турнира обновлен на ${status}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить статистику
app.get('/api/admin/stats', async (req, res) => {
    try {
        const usersCount = await pool.query('SELECT COUNT(*) as count FROM users');
        const tournamentsCount = await pool.query('SELECT COUNT(*) as count FROM tournaments');
        const activeGamesCount = await pool.query('SELECT COUNT(*) as count FROM tournaments WHERE status = $1', ['active']);
        
        res.json({
            totalUsers: parseInt(usersCount.rows[0].count),
            totalTournaments: parseInt(tournamentsCount.rows[0].count),
            activeGames: parseInt(activeGamesCount.rows[0].count)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Корневой маршрут
app.get('/', (req, res) => {
    res.send('<h1>🎲 Poker Club API Server is running!</h1><p>Access API at /api</p>');
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Poker Club API сервер запущен на порту ${PORT}`);
    console.log(`📱 API доступен по адресу: http://localhost:${PORT}/api`);
});

// Обработка завершения
process.on('SIGINT', async () => {
    console.log('🛑 Остановка сервера...');
    await pool.end();
    process.exit(0);
});


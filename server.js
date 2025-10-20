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

// Система начисления очков
const POINTS_SYSTEM = {
    1: 300,
    2: 240,
    3: 195,
    4: 150,
    5: 150,
    6: 90,
    7: 90,
    8: 90,
    9: 90,
    10: 90,
    default: 30 // 11+ место
};

// Инициализация базы данных
async function initDatabase() {
    try {
        // Таблица пользователей
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
                registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица турниров (больших, например "Летний 2025")
        await pool.query(`
            CREATE TABLE IF NOT EXISTS big_tournaments (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                start_date TIMESTAMP NOT NULL,
                end_date TIMESTAMP,
                grand_final_date TIMESTAMP,
                status TEXT DEFAULT 'active',
                top_players_count INTEGER DEFAULT 20,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица игр (игры внутри турнира)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                tournament_id INTEGER REFERENCES big_tournaments(id),
                game_number INTEGER NOT NULL,
                date TIMESTAMP NOT NULL,
                max_players INTEGER DEFAULT 30,
                min_players INTEGER DEFAULT 8,
                buyin_amount INTEGER DEFAULT 1500,
                status TEXT DEFAULT 'upcoming',
                registration_deadline TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица участников игры
        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_registrations (
                id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES games(id),
                user_id INTEGER REFERENCES users(id),
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cancelled_at TIMESTAMP,
                is_paid BOOLEAN DEFAULT FALSE,
                paid_at TIMESTAMP,
                status TEXT DEFAULT 'registered',
                UNIQUE(game_id, user_id)
            )
        `);

        // Таблица результатов игры
        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_results (
                id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES games(id),
                user_id INTEGER REFERENCES users(id),
                place INTEGER NOT NULL,
                points_earned INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(game_id, user_id)
            )
        `);

        // Таблица турнирной таблицы (standings)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tournament_standings (
                id SERIAL PRIMARY KEY,
                tournament_id INTEGER REFERENCES big_tournaments(id),
                user_id INTEGER REFERENCES users(id),
                total_points INTEGER DEFAULT 0,
                games_played INTEGER DEFAULT 0,
                average_place DECIMAL(4,2),
                best_place INTEGER,
                in_grand_final BOOLEAN DEFAULT FALSE,
                position INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tournament_id, user_id)
            )
        `);

        // Таблица штрафов
        await pool.query(`
            CREATE TABLE IF NOT EXISTS penalties (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                game_id INTEGER REFERENCES games(id),
                tournament_id INTEGER REFERENCES big_tournaments(id),
                reason TEXT NOT NULL,
                points_deducted INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ База данных инициализирована с новой схемой');
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error);
    }
}

initDatabase();

// ============================================
// API ROUTES - ПОЛЬЗОВАТЕЛИ
// ============================================

// Получить всех пользователей
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users ORDER BY game_nickname ASC');
        const users = result.rows.map(row => ({
            id: row.id,
            telegramId: row.telegram_id,
            telegramName: row.telegram_name,
            telegramUsername: row.telegram_username,
            gameNickname: row.game_nickname,
            preferredGame: row.preferred_game,
            avatar: row.avatar,
            telegramAvatarUrl: row.telegram_avatar_url,
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
        const { gameNickname, preferredGame, avatar, telegramAvatarUrl, telegramName, telegramUsername } = req.body;
        
        let updates = [];
        let values = [];
        let paramIndex = 1;
        
        if (gameNickname) { updates.push(`game_nickname = $${paramIndex++}`); values.push(gameNickname); }
        if (preferredGame) { updates.push(`preferred_game = $${paramIndex++}`); values.push(preferredGame); }
        if (avatar) { updates.push(`avatar = $${paramIndex++}`); values.push(avatar); }
        if (telegramAvatarUrl !== undefined) { updates.push(`telegram_avatar_url = $${paramIndex++}`); values.push(telegramAvatarUrl); }
        if (telegramName) { updates.push(`telegram_name = $${paramIndex++}`); values.push(telegramName); }
        if (telegramUsername) { updates.push(`telegram_username = $${paramIndex++}`); values.push(telegramUsername); }
        
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
            registrationDate: row.registration_date
        };
        
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// API ROUTES - БОЛЬШИЕ ТУРНИРЫ
// ============================================

// Получить все турниры
app.get('/api/big-tournaments', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM big_tournaments ORDER BY start_date DESC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить активные турниры
app.get('/api/big-tournaments/active', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM big_tournaments WHERE status = $1 ORDER BY start_date DESC', ['active']);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Создать большой турнир
app.post('/api/big-tournaments', async (req, res) => {
    try {
        const { name, description, startDate, topPlayersCount } = req.body;
        
        const result = await pool.query(
            'INSERT INTO big_tournaments (name, description, start_date, top_players_count) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, description, startDate, topPlayersCount || 20]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновить турнир
app.put('/api/big-tournaments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { grandFinalDate, status, endDate } = req.body;
        
        let updates = [];
        let values = [];
        let paramIndex = 1;
        
        if (grandFinalDate) { updates.push(`grand_final_date = $${paramIndex++}`); values.push(grandFinalDate); }
        if (status) { updates.push(`status = $${paramIndex++}`); values.push(status); }
        if (endDate) { updates.push(`end_date = $${paramIndex++}`); values.push(endDate); }
        
        if (updates.length === 0) {
            return res.status(400).json({ message: 'Нет данных для обновления' });
        }
        
        values.push(id);
        const query = `UPDATE big_tournaments SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        
        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// API ROUTES - ИГРЫ
// ============================================

// Получить все игры
app.get('/api/games', async (req, res) => {
    try {
        const { tournamentId } = req.query;
        
        let query = `
            SELECT g.*, bt.name as tournament_name,
                   COUNT(DISTINCT gr.id) as registered_count,
                   COUNT(DISTINCT CASE WHEN gr.is_paid = true THEN gr.id END) as paid_count
            FROM games g
            LEFT JOIN big_tournaments bt ON g.tournament_id = bt.id
            LEFT JOIN game_registrations gr ON g.id = gr.game_id AND gr.status != 'cancelled'
        `;
        
        let values = [];
        if (tournamentId) {
            query += ' WHERE g.tournament_id = $1';
            values.push(tournamentId);
        }
        
        query += ' GROUP BY g.id, bt.name ORDER BY g.date ASC';
        
        const result = await pool.query(query, values);
        
        const games = result.rows.map(row => ({
            ...row,
            registeredCount: parseInt(row.registered_count),
            paidCount: parseInt(row.paid_count)
        }));
        
        res.json(games);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить игру по ID с участниками
app.get('/api/games/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Получаем игру
        const gameResult = await pool.query('SELECT g.*, bt.name as tournament_name FROM games g LEFT JOIN big_tournaments bt ON g.tournament_id = bt.id WHERE g.id = $1', [id]);
        
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ message: 'Игра не найдена' });
        }
        
        const game = gameResult.rows[0];
        
        // Получаем участников
        const participantsResult = await pool.query(`
            SELECT u.*, gr.registered_at, gr.is_paid, gr.status, gr.cancelled_at
            FROM game_registrations gr
            JOIN users u ON gr.user_id = u.id
            WHERE gr.game_id = $1 AND gr.status != 'cancelled'
            ORDER BY gr.registered_at ASC
        `, [id]);
        
        game.participants = participantsResult.rows;
        game.registeredCount = participantsResult.rows.length;
        game.paidCount = participantsResult.rows.filter(p => p.is_paid).length;
        
        res.json(game);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Создать игру
app.post('/api/games', async (req, res) => {
    try {
        const { tournamentId, gameNumber, date, maxPlayers, minPlayers, buyinAmount } = req.body;
        
        // Автоматически устанавливаем дедлайн регистрации (2 часа после начала)
        const gameDate = new Date(date);
        const registrationDeadline = new Date(gameDate.getTime() + 2 * 60 * 60 * 1000);
        
        const result = await pool.query(
            'INSERT INTO games (tournament_id, game_number, date, max_players, min_players, buyin_amount, registration_deadline) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [tournamentId, gameNumber, date, maxPlayers || 30, minPlayers || 8, buyinAmount || 1500, registrationDeadline]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновить статус игры
app.put('/api/games/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        await pool.query('UPDATE games SET status = $1 WHERE id = $2', [status, id]);
        
        res.json({ message: `Статус игры обновлен на ${status}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// API ROUTES - РЕГИСТРАЦИЯ НА ИГРЫ
// ============================================

// Зарегистрироваться на игру
app.post('/api/games/:gameId/register', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { userId } = req.body;
        
        // Проверяем игру
        const gameResult = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Игра не найдена' });
        }
        
        const game = gameResult.rows[0];
        
        // Проверяем, не закончилась ли регистрация
        const now = new Date();
        if (game.registration_deadline && new Date(game.registration_deadline) < now) {
            return res.status(400).json({ error: 'Регистрация на эту игру закрыта' });
        }
        
        // Проверяем, не зарегистрирован ли уже
        const existingResult = await pool.query(
            'SELECT * FROM game_registrations WHERE game_id = $1 AND user_id = $2 AND status != $3',
            [gameId, userId, 'cancelled']
        );
        
        if (existingResult.rows.length > 0) {
            return res.status(400).json({ error: 'Вы уже зарегистрированы на эту игру' });
        }
        
        // Проверяем лимит участников
        const countResult = await pool.query(
            'SELECT COUNT(*) as count FROM game_registrations WHERE game_id = $1 AND status != $2',
            [gameId, 'cancelled']
        );
        
        if (parseInt(countResult.rows[0].count) >= game.max_players) {
            return res.status(400).json({ error: 'Игра заполнена' });
        }
        
        // Регистрируем
        await pool.query(
            'INSERT INTO game_registrations (game_id, user_id, status) VALUES ($1, $2, $3)',
            [gameId, userId, 'registered']
        );
        
        res.json({ message: 'Вы успешно зарегистрированы на игру' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Отменить регистрацию
app.post('/api/games/:gameId/cancel', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { userId } = req.body;
        
        // Получаем игру
        const gameResult = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Игра не найдена' });
        }
        
        const game = gameResult.rows[0];
        const gameDate = new Date(game.date);
        const now = new Date();
        const hoursUntilGame = (gameDate - now) / (1000 * 60 * 60);
        
        // Получаем регистрацию
        const regResult = await pool.query(
            'SELECT * FROM game_registrations WHERE game_id = $1 AND user_id = $2 AND status = $3',
            [gameId, userId, 'registered']
        );
        
        if (regResult.rows.length === 0) {
            return res.status(404).json({ error: 'Регистрация не найдена' });
        }
        
        const registration = regResult.rows[0];
        
        // Проверяем время до игры
        if (hoursUntilGame < 12) {
            // Штраф!
            await pool.query(
                'UPDATE game_registrations SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['cancelled_with_penalty', registration.id]
            );
            
            // Применяем штраф к турнирной таблице
            if (game.tournament_id) {
                await applyPenalty(userId, gameId, game.tournament_id, 'Отмена менее чем за 12 часов', 100);
            }
            
            return res.json({ 
                message: 'Регистрация отменена. Применён штраф -100 очков за позднюю отмену',
                penalty: true,
                pointsDeducted: 100
            });
        } else {
            // Отменяем без штрафа
            await pool.query(
                'UPDATE game_registrations SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['cancelled', registration.id]
            );
            
            return res.json({ 
                message: 'Регистрация успешно отменена',
                penalty: false
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Отметить оплату (только для админа)
app.put('/api/games/:gameId/mark-paid', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { userId, isPaid } = req.body;
        
        await pool.query(
            'UPDATE game_registrations SET is_paid = $1, paid_at = CASE WHEN $1 = true THEN CURRENT_TIMESTAMP ELSE NULL END WHERE game_id = $2 AND user_id = $3',
            [isPaid, gameId, userId]
        );
        
        res.json({ message: `Статус оплаты обновлен` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// API ROUTES - РЕЗУЛЬТАТЫ ИГР
// ============================================

// Внести результаты игры
app.post('/api/games/:gameId/results', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { results } = req.body; // [{userId, place}, ...]
        
        // Получаем игру
        const gameResult = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Игра не найдена' });
        }
        
        const game = gameResult.rows[0];
        
        // Удаляем старые результаты (если исправляем)
        await pool.query('DELETE FROM game_results WHERE game_id = $1', [gameId]);
        
        // Вносим новые результаты
        for (const result of results) {
            const points = POINTS_SYSTEM[result.place] || POINTS_SYSTEM.default;
            
            await pool.query(
                'INSERT INTO game_results (game_id, user_id, place, points_earned) VALUES ($1, $2, $3, $4)',
                [gameId, result.userId, result.place, points]
            );
        }
        
        // Применяем штрафы за неявку
        const registeredResult = await pool.query(
            'SELECT user_id FROM game_registrations WHERE game_id = $1 AND status = $2 AND is_paid = false',
            [gameId, 'registered']
        );
        
        for (const reg of registeredResult.rows) {
            // Проверяем, есть ли результат для этого пользователя
            const hasResult = results.some(r => r.userId === reg.user_id);
            
            if (!hasResult) {
                // Не оплатил и не пришёл - штраф
                await applyPenalty(reg.user_id, gameId, game.tournament_id, 'Неявка без оплаты', 100);
            }
        }
        
        // Обновляем турнирную таблицу
        await updateTournamentStandings(game.tournament_id);
        
        // Обновляем статус игры
        await pool.query('UPDATE games SET status = $1 WHERE id = $2', ['finished', gameId]);
        
        res.json({ message: 'Результаты сохранены успешно' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить результаты игры
app.get('/api/games/:gameId/results', async (req, res) => {
    try {
        const { gameId } = req.params;
        
        const result = await pool.query(`
            SELECT gr.*, u.game_nickname, u.avatar
            FROM game_results gr
            JOIN users u ON gr.user_id = u.id
            WHERE gr.game_id = $1
            ORDER BY gr.place ASC
        `, [gameId]);
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// API ROUTES - ТУРНИРНАЯ ТАБЛИЦА
// ============================================

// Получить турнирную таблицу
app.get('/api/tournaments/:tournamentId/standings', async (req, res) => {
    try {
        const { tournamentId } = req.params;
        
        const result = await pool.query(`
            SELECT ts.*, u.game_nickname, u.avatar, u.telegram_id
            FROM tournament_standings ts
            JOIN users u ON ts.user_id = u.id
            WHERE ts.tournament_id = $1
            ORDER BY ts.total_points DESC, ts.games_played ASC
        `, [tournamentId]);
        
        // Обновляем позиции
        result.rows.forEach((row, index) => {
            row.position = index + 1;
            row.inGrandFinal = row.position <= 20;
        });
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить мою позицию в турнире
app.get('/api/tournaments/:tournamentId/my-standing/:userId', async (req, res) => {
    try {
        const { tournamentId, userId } = req.params;
        
        // Получаем позицию пользователя
        const result = await pool.query(`
            SELECT 
                ts.*,
                (SELECT COUNT(*) FROM tournament_standings WHERE tournament_id = $1 AND total_points > ts.total_points) + 1 as position,
                (SELECT total_points FROM tournament_standings WHERE tournament_id = $1 ORDER BY total_points DESC LIMIT 1 OFFSET 19) as top20_threshold
            FROM tournament_standings ts
            WHERE ts.tournament_id = $1 AND ts.user_id = $2
        `, [tournamentId, userId]);
        
        if (result.rows.length === 0) {
            // Создаём запись если её нет
            await pool.query(
                'INSERT INTO tournament_standings (tournament_id, user_id, total_points, games_played) VALUES ($1, $2, $3, $4)',
                [tournamentId, userId, 0, 0]
            );
            
            return res.json({
                position: null,
                totalPoints: 0,
                gamesPlayed: 0,
                pointsToTop20: null,
                inGrandFinal: false
            });
        }
        
        const standing = result.rows[0];
        const top20Threshold = standing.top20_threshold || 0;
        const pointsToTop20 = standing.position > 20 ? top20Threshold - standing.total_points : 0;
        
        res.json({
            position: standing.position,
            totalPoints: standing.total_points,
            gamesPlayed: standing.games_played,
            averagePlace: standing.average_place,
            bestPlace: standing.best_place,
            pointsToTop20: pointsToTop20,
            inGrandFinal: standing.position <= 20
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// API ROUTES - ИСТОРИЯ ИГР ПОЛЬЗОВАТЕЛЯ
// ============================================

// Получить историю игр пользователя
app.get('/api/users/:userId/game-history', async (req, res) => {
    try {
        const { userId } = req.params;
        const { tournamentId } = req.query;
        
        let query = `
            SELECT g.*, gr.place, gr.points_earned, bt.name as tournament_name
            FROM game_results gr
            JOIN games g ON gr.game_id = g.id
            LEFT JOIN big_tournaments bt ON g.tournament_id = bt.id
            WHERE gr.user_id = $1
        `;
        
        let values = [userId];
        
        if (tournamentId) {
            query += ' AND g.tournament_id = $2';
            values.push(tournamentId);
        }
        
        query += ' ORDER BY g.date DESC';
        
        const result = await pool.query(query, values);
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// API ROUTES - СТАТИСТИКА
// ============================================

// Получить общую статистику
app.get('/api/admin/stats', async (req, res) => {
    try {
        const usersCount = await pool.query('SELECT COUNT(*) as count FROM users');
        const tournamentsCount = await pool.query('SELECT COUNT(*) as count FROM big_tournaments WHERE status = $1', ['active']);
        const gamesCount = await pool.query('SELECT COUNT(*) as count FROM games WHERE status = $1', ['upcoming']);
        
        res.json({
            totalUsers: parseInt(usersCount.rows[0].count),
            activeTournaments: parseInt(tournamentsCount.rows[0].count),
            upcomingGames: parseInt(gamesCount.rows[0].count)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

// Применить штраф
async function applyPenalty(userId, gameId, tournamentId, reason, points) {
    try {
        // Записываем штраф
        await pool.query(
            'INSERT INTO penalties (user_id, game_id, tournament_id, reason, points_deducted) VALUES ($1, $2, $3, $4, $5)',
            [userId, gameId, tournamentId, reason, points]
        );
        
        // Обновляем турнирную таблицу
        const standingResult = await pool.query(
            'SELECT * FROM tournament_standings WHERE tournament_id = $1 AND user_id = $2',
            [tournamentId, userId]
        );
        
        if (standingResult.rows.length > 0) {
            const currentPoints = standingResult.rows[0].total_points;
            const newPoints = Math.max(0, currentPoints - points);
            
            await pool.query(
                'UPDATE tournament_standings SET total_points = $1 WHERE tournament_id = $2 AND user_id = $3',
                [newPoints, tournamentId, userId]
            );
        }
    } catch (error) {
        console.error('Ошибка применения штрафа:', error);
    }
}

// Обновить турнирную таблицу
async function updateTournamentStandings(tournamentId) {
    try {
        // Получаем все результаты для турнира
        const resultsResult = await pool.query(`
            SELECT gr.user_id, 
                   SUM(gr.points_earned) as total_points,
                   COUNT(gr.id) as games_played,
                   AVG(gr.place) as average_place,
                   MIN(gr.place) as best_place
            FROM game_results gr
            JOIN games g ON gr.game_id = g.id
            WHERE g.tournament_id = $1
            GROUP BY gr.user_id
        `, [tournamentId]);
        
        // Обновляем каждого пользователя
        for (const result of resultsResult.rows) {
            await pool.query(`
                INSERT INTO tournament_standings (tournament_id, user_id, total_points, games_played, average_place, best_place)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (tournament_id, user_id)
                DO UPDATE SET 
                    total_points = $3,
                    games_played = $4,
                    average_place = $5,
                    best_place = $6,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                tournamentId,
                result.user_id,
                result.total_points,
                result.games_played,
                result.average_place,
                result.best_place
            ]);
        }
        
        console.log('Турнирная таблица обновлена');
    } catch (error) {
        console.error('Ошибка обновления турнирной таблицы:', error);
    }
}

// Автоматическое закрытие регистрации
setInterval(async () => {
    try {
        const now = new Date();
        
        // Находим игры с истёкшим дедлайном
        const result = await pool.query(
            'SELECT id FROM games WHERE registration_deadline < $1 AND status = $2',
            [now, 'upcoming']
        );
        
        for (const game of result.rows) {
            // Обновляем статус
            await pool.query('UPDATE games SET status = $1 WHERE id = $2', ['in_progress', game.id]);
            console.log(`Регистрация закрыта для игры #${game.id}`);
        }
    } catch (error) {
        console.error('Ошибка автозакрытия регистрации:', error);
    }
}, 60000); // Проверяем каждую минуту

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

app.get('/', (req, res) => {
    res.send('<h1>🎲 Poker Club API Server v2.0 is running!</h1><p>Система турниров с играми и очками активна</p>');
});

app.listen(PORT, () => {
    console.log(`🚀 Poker Club API сервер v2.0 запущен на порту ${PORT}`);
    console.log(`📱 API доступен по адресу: http://localhost:${PORT}/api`);
    console.log(`🎮 Система игр и турниров активна`);
});

process.on('SIGINT', async () => {
    console.log('🛑 Остановка сервера...');
    await pool.end();
    process.exit(0);
});

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*', // Разрешаем все источники для Telegram Mini App
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json()); // Для парсинга JSON-тел запросов

// Инициализация базы данных SQLite
const db = new sqlite3.Database('poker_club.db');

// Создание таблиц, если они не существуют
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    telegram_name TEXT,
    telegram_username TEXT,
    game_nickname TEXT UNIQUE NOT NULL,
    preferred_game TEXT,
    avatar TEXT DEFAULT '👤',
    telegram_avatar_url TEXT,
    total_wins INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    registration_date DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date DATETIME NOT NULL,
    duration INTEGER DEFAULT 2, -- Продолжительность в часах
    max_players INTEGER NOT NULL,
    prize INTEGER NOT NULL,
    status TEXT DEFAULT 'upcoming', -- upcoming, active, finished
    type TEXT DEFAULT 'texas_holdem'
)`);

db.run(`CREATE TABLE IF NOT EXISTS tournament_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER,
    user_id INTEGER,
    join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
)`);

// API Endpoints

// Получить всех пользователей
app.get('/api/users', (req, res) => {
    db.all('SELECT * FROM users ORDER BY points DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        // Преобразуем данные для соответствия фронтенду
        const users = rows.map(row => ({
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
                currentRank: 1 // Ранг будет вычисляться на фронтенде
            },
            registrationDate: row.registration_date
        }));
        res.json(users);
    });
});

// Получить пользователя по Telegram ID
app.get('/api/users/telegram/:telegramId', (req, res) => {
    const telegramId = req.params.telegramId;
    db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ message: 'Пользователь не найден' });
            return;
        }
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
    });
});

// Создать пользователя
app.post('/api/users', (req, res) => {
    const { telegramId, telegramName, telegramUsername, gameNickname, preferredGame, avatar, telegramAvatarUrl } = req.body;

    // Проверка на уникальность telegramId или gameNickname
    db.get('SELECT * FROM users WHERE telegram_id = ? OR game_nickname = ?', [telegramId, gameNickname], (err, existing) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (existing) {
            res.status(400).json({ error: "Пользователь с таким Telegram ID или никнеймом уже существует" });
            return;
        }

        db.run(
            'INSERT INTO users (telegram_id, telegram_name, telegram_username, game_nickname, preferred_game, avatar, telegram_avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [telegramId, telegramName, telegramUsername, gameNickname, preferredGame, avatar, telegramAvatarUrl],
            function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                db.get('SELECT * FROM users WHERE id = ?', [this.lastID], (err, user) => {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    const newUser = {
                        id: user.id,
                        telegramId: user.telegram_id,
                        telegramName: user.telegram_name,
                        telegramUsername: user.telegram_username,
                        gameNickname: user.game_nickname,
                        preferredGame: user.preferred_game,
                        avatar: user.avatar,
                        telegramAvatarUrl: user.telegram_avatar_url,
                        stats: {
                            totalWins: user.total_wins,
                            totalGames: user.total_games,
                            points: user.points,
                            currentRank: 1
                        },
                        registrationDate: user.registration_date
                    };
                    res.status(201).json(newUser);
                });
            }
        );
    });
});

// Обновить пользователя (например, аватарку или статистику)
app.put('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    const { gameNickname, preferredGame, avatar, telegramAvatarUrl, stats } = req.body;
    
    let updateFields = [];
    let updateValues = [];

    if (gameNickname) { updateFields.push('game_nickname = ?'); updateValues.push(gameNickname); }
    if (preferredGame) { updateFields.push('preferred_game = ?'); updateValues.push(preferredGame); }
    if (avatar) { updateFields.push('avatar = ?'); updateValues.push(avatar); }
    if (telegramAvatarUrl) { updateFields.push('telegram_avatar_url = ?'); updateValues.push(telegramAvatarUrl); }
    if (stats) {
        if (stats.totalWins !== undefined) { updateFields.push('total_wins = ?'); updateValues.push(stats.totalWins); }
        if (stats.totalGames !== undefined) { updateFields.push('total_games = ?'); updateValues.push(stats.totalGames); }
        if (stats.points !== undefined) { updateFields.push('points = ?'); updateValues.push(stats.points); }
    }

    if (updateFields.length === 0) {
        res.status(400).json({ message: "Нет данных для обновления" });
        return;
    }

    const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
    updateValues.push(userId);

    db.run(query, updateValues, function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.status(404).json({ message: "Пользователь не найден" });
            return;
        }
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            const updatedUser = {
                id: user.id,
                telegramId: user.telegram_id,
                telegramName: user.telegram_name,
                telegramUsername: user.telegram_username,
                gameNickname: user.game_nickname,
                preferredGame: user.preferred_game,
                avatar: user.avatar,
                telegramAvatarUrl: user.telegram_avatar_url,
                stats: {
                    totalWins: user.total_wins,
                    totalGames: user.total_games,
                    points: user.points,
                    currentRank: 1
                },
                registrationDate: user.registration_date
            };
            res.json(updatedUser);
        });
    });
});

// Получить все турниры
app.get('/api/tournaments', (req, res) => {
    db.all('SELECT * FROM tournaments ORDER BY date ASC', (err, tournaments) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        const tournamentsWithParticipants = tournaments.map(tournament => {
            return new Promise((resolve) => {
                db.all('SELECT u.id, u.telegram_id, u.game_nickname, u.avatar, u.telegram_avatar_url, tp.join_date FROM tournament_participants tp JOIN users u ON tp.user_id = u.id WHERE tp.tournament_id = ?', [tournament.id], (err, participants) => {
                    if (err) {
                        console.error(`Error fetching participants for tournament ${tournament.id}:`, err.message);
                        resolve({ ...tournament, participants: [] });
                    } else {
                        const formattedParticipants = participants.map(p => ({
                            id: p.id,
                            telegramId: p.telegram_id,
                            nickname: p.game_nickname,
                            avatar: p.avatar,
                            telegramAvatarUrl: p.telegram_avatar_url,
                            joinDate: p.join_date
                        }));
                        resolve({ ...tournament, participants: formattedParticipants });
                    }
                });
            });
        });

        Promise.all(tournamentsWithParticipants).then(results => {
            res.json(results);
        });
    });
});

// Создать турнир
app.post('/api/tournaments', (req, res) => {
    const { name, date, duration, maxPlayers, prize, type } = req.body;
    db.run(
        'INSERT INTO tournaments (name, date, duration, max_players, prize, status, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, date, duration, maxPlayers, prize, 'upcoming', type],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.status(201).json({ id: this.lastID, name, date, duration, maxPlayers, prize, status: 'upcoming', type, participants: [] });
        }
    );
});

// Присоединиться к турниру
app.post('/api/tournaments/:tournamentId/join', (req, res) => {
    const tournamentId = req.params.tournamentId;
    const { userId } = req.body; // userId - это id пользователя в базе данных

    db.get('SELECT * FROM tournament_participants WHERE tournament_id = ? AND user_id = ?', [tournamentId, userId], (err, existing) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (existing) {
            res.status(400).json({ error: "Вы уже участвуете в этом турнире" });
            return;
        }

        // Проверить, не заполнен ли турнир
        db.get('SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = ?', [tournamentId], (err, result) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            const currentParticipants = result.count;

            db.get('SELECT max_players FROM tournaments WHERE id = ?', [tournamentId], (err, tournament) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                if (!tournament) {
                    res.status(404).json({ message: "Турнир не найден" });
                    return;
                }

                if (currentParticipants >= tournament.max_players) {
                    res.status(400).json({ error: "Турнир заполнен" });
                    return;
                }

                db.run('INSERT INTO tournament_participants (tournament_id, user_id) VALUES (?, ?)', [tournamentId, userId], function(err) {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    res.json({ message: "Вы присоединились к турниру" });
                });
            });
        });
    });
});

// Обновить статус турнира
app.put('/api/tournaments/:id/status', (req, res) => {
    const tournamentId = req.params.id;
    const { status } = req.body; // 'active' или 'finished'

    db.run('UPDATE tournaments SET status = ? WHERE id = ?', [status, tournamentId], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.status(404).json({ message: "Турнир не найден" });
            return;
        }
        res.json({ message: `Статус турнира обновлен на ${status}` });
    });
});

// Получить статистику для админ-панели
app.get('/api/admin/stats', (req, res) => {
    let totalUsers = 0;
    let totalTournaments = 0;
    let activeGames = 0;

    db.get('SELECT COUNT(*) as count FROM users', (err, result) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        totalUsers = result.count;

        db.get('SELECT COUNT(*) as count FROM tournaments', (err, result) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            totalTournaments = result.count;

            db.get('SELECT COUNT(*) as count FROM tournaments WHERE status = "active"', (err, result) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                activeGames = result.count;
                res.json({ totalUsers, totalTournaments, activeGames });
            });
        });
    });
});

// Простой маршрут для корневого URL
app.get('/', (req, res) => {
    res.send('<h1>Poker Club API Server is running!</h1><p>Access API at /api</p><p><a href="/admin.html">Admin Panel</a></p>');
});

// Обслуживание статических файлов для админ-панели
app.use(express.static('public'));

// Запуск сервера
app.listen(PORT, () => {
    console.log('🚀 Poker Club API сервер запущен на порту ' + PORT);
    console.log('📱 API доступен по адресу: http://localhost:' + PORT + '/api');
});

// Обработка завершения работы сервера
process.on('SIGINT', () => {
    console.log('🛑 Остановка сервера...');
    db.close((err) => {
        if (err) {
            console.error('Ошибка при закрытии базы данных:', err.message);
        } else {
            console.log('База данных закрыта.');
        }
        process.exit(0);
    });
});

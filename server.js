const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('poker_club.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    telegram_name TEXT,
    game_nickname TEXT UNIQUE NOT NULL,
    preferred_game TEXT,
    avatar TEXT DEFAULT '👤',
    total_wins INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date DATETIME NOT NULL,
    max_players INTEGER NOT NULL,
    prize INTEGER NOT NULL,
    status TEXT DEFAULT 'upcoming'
)`);

db.run(`CREATE TABLE IF NOT EXISTS tournament_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER,
    user_id INTEGER,
    join_date DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.get('/api/users', (req, res) => {
    db.all('SELECT * FROM users ORDER BY points DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.post('/api/users', (req, res) => {
    const { telegramId, telegramName, gameNickname, preferredGame } = req.body;
    
    db.get('SELECT * FROM users WHERE telegram_id = ? OR game_nickname = ?', 
        [telegramId, gameNickname], (err, existing) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (existing) {
                res.status(400).json({ error: 'Пользователь уже существует' });
                return;
            }
            
            db.run('INSERT INTO users (telegram_id, telegram_name, game_nickname, preferred_game) VALUES (?, ?, ?, ?)',
                [telegramId, telegramName, gameNickname, preferredGame],
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
                        res.status(201).json(user);
                    });
                }
            );
        }
    );
});

app.get('/api/tournaments', (req, res) => {
    db.all('SELECT * FROM tournaments ORDER BY date ASC', (err, tournaments) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        const tournamentsWithParticipants = tournaments.map(tournament => {
            return new Promise((resolve) => {
                db.all('SELECT u.*, tp.join_date FROM tournament_participants tp JOIN users u ON tp.user_id = u.id WHERE tp.tournament_id = ?',
                    [tournament.id],
                    (err, participants) => {
                        if (err) {
                            resolve({ ...tournament, participants: [] });
                        } else {
                            resolve({ ...tournament, participants });
                        }
                    }
                );
            });
        });
        
        Promise.all(tournamentsWithParticipants).then(results => {
            res.json(results);
        });
    });
});

app.post('/api/tournaments', (req, res) => {
    const { name, date, maxPlayers, prize } = req.body;
    
    db.run('INSERT INTO tournaments (name, date, max_players, prize) VALUES (?, ?, ?, ?)',
        [name, date, maxPlayers, prize],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.status(201).json({ id: this.lastID, message: 'Турнир создан' });
        }
    );
});

app.post('/api/tournaments/:tournamentId/join', (req, res) => {
    const tournamentId = req.params.tournamentId;
    const { userId } = req.body;
    
    db.get('SELECT * FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
        [tournamentId, userId], (err, existing) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (existing) {
                res.status(400).json({ error: 'Вы уже участвуете в этом турнире' });
                return;
            }
            
            db.run('INSERT INTO tournament_participants (tournament_id, user_id) VALUES (?, ?)',
                [tournamentId, userId],
                function(err) {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    res.json({ message: 'Вы присоединились к турниру' });
                }
            );
        }
    );
});

app.get('/api/admin/stats', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM users', (err, result) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const totalUsers = result.count;
        
        db.get('SELECT COUNT(*) as count FROM tournaments', (err, result) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            const totalTournaments = result.count;
            
            res.json({ totalUsers, totalTournaments, activeGames: 0 });
        });
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Poker Club API сервер запущен на порту ${PORT}`);
    console.log(`📱 API доступен по адресу: http://localhost:${PORT}/api`);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Остановка сервера...');
    db.close();
    process.exit(0);
});
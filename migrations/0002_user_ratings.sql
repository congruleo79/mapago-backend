PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN current_rating INTEGER NOT NULL DEFAULT 1500;

CREATE TABLE user_rating_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  opponent_user_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  rating_change INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (opponent_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  UNIQUE (user_id, opponent_user_id, game_id),
  CHECK (user_id != opponent_user_id)
);

CREATE INDEX idx_user_rating_events_user_created_at ON user_rating_events(user_id, created_at DESC);
CREATE INDEX idx_user_rating_events_game_user ON user_rating_events(game_id, user_id);
CREATE INDEX idx_user_rating_events_opponent_created_at ON user_rating_events(opponent_user_id, created_at DESC);
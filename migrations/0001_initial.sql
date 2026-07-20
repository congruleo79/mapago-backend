PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  game_date TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  game_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  region TEXT,
  iso_country_code TEXT,
  description TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  location_link TEXT,
  source_link TEXT,
  page_views INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  UNIQUE (game_id, ordinal)
);

CREATE INDEX idx_locations_game_id ON locations(game_id);

CREATE TABLE plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  game_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  total_score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (game_id, user_id)
);

CREATE INDEX idx_plays_game_id ON plays(game_id);
CREATE INDEX idx_plays_user_id ON plays(user_id);
CREATE INDEX idx_plays_game_finalized_score ON plays(game_id, finalized_at, total_score DESC);

CREATE TABLE guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  play_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  guess_latitude REAL NOT NULL,
  guess_longitude REAL NOT NULL,
  distance_meters REAL NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
  UNIQUE (play_id, location_id)
);

CREATE INDEX idx_guesses_play_id ON guesses(play_id);

CREATE TABLE follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  follower_user_id INTEGER NOT NULL,
  followed_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (followed_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (follower_user_id, followed_user_id),
  CHECK (follower_user_id != followed_user_id)
);

CREATE INDEX idx_follows_follower_user_id ON follows(follower_user_id);

CREATE TABLE auth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (provider, provider_subject)
);
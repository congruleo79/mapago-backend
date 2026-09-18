PRAGMA foreign_keys = ON;

CREATE TABLE friends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  lower_user_id INTEGER NOT NULL,
  higher_user_id INTEGER NOT NULL,
  lower_user_accepted INTEGER NOT NULL DEFAULT 0,
  higher_user_accepted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lower_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (higher_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (lower_user_id, higher_user_id),
  CHECK (lower_user_id < higher_user_id),
  CHECK (lower_user_accepted IN (0, 1)),
  CHECK (higher_user_accepted IN (0, 1))
);

CREATE INDEX idx_friends_lower_user_id ON friends(lower_user_id);
CREATE INDEX idx_friends_higher_user_id ON friends(higher_user_id);

INSERT INTO friends (
  public_id,
  lower_user_id,
  higher_user_id,
  lower_user_accepted,
  higher_user_accepted,
  created_at,
  updated_at
)
SELECT
  printf('frd_migr_%d_%d', pairs.lower_user_id, pairs.higher_user_id),
  pairs.lower_user_id,
  pairs.higher_user_id,
  CASE
    WHEN EXISTS(
      SELECT 1
      FROM follows f
      WHERE f.follower_user_id = pairs.lower_user_id AND f.followed_user_id = pairs.higher_user_id
    ) THEN 1
    ELSE 0
  END,
  CASE
    WHEN EXISTS(
      SELECT 1
      FROM follows f
      WHERE f.follower_user_id = pairs.higher_user_id AND f.followed_user_id = pairs.lower_user_id
    ) THEN 1
    ELSE 0
  END,
  COALESCE(
    (
      SELECT MIN(f.created_at)
      FROM follows f
      WHERE (f.follower_user_id = pairs.lower_user_id AND f.followed_user_id = pairs.higher_user_id)
         OR (f.follower_user_id = pairs.higher_user_id AND f.followed_user_id = pairs.lower_user_id)
    ),
    CURRENT_TIMESTAMP
  ),
  COALESCE(
    (
      SELECT MAX(f.created_at)
      FROM follows f
      WHERE (f.follower_user_id = pairs.lower_user_id AND f.followed_user_id = pairs.higher_user_id)
         OR (f.follower_user_id = pairs.higher_user_id AND f.followed_user_id = pairs.lower_user_id)
    ),
    CURRENT_TIMESTAMP
  )
FROM (
  SELECT DISTINCT
    CASE WHEN follower_user_id < followed_user_id THEN follower_user_id ELSE followed_user_id END AS lower_user_id,
    CASE WHEN follower_user_id < followed_user_id THEN followed_user_id ELSE follower_user_id END AS higher_user_id
  FROM follows
) pairs;

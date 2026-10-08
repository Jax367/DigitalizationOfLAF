ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'
 CHECK (approval_status IN ('pending', 'approved', 'rejected', 'disabled'));
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE images (id TEXT PRIMARY KEY, object_key TEXT UNIQUE NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE items ADD COLUMN image_id TEXT REFERENCES images(id) ON DELETE RESTRICT;
CREATE INDEX idx_items_image ON items(image_id);
CREATE TABLE auth_throttle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE TABLE bootstrap_guard (id INTEGER PRIMARY KEY CHECK (id = 1));

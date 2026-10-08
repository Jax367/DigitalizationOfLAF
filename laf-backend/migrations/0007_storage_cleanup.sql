CREATE TABLE image_deletions(id TEXT PRIMARY KEY,object_key TEXT NOT NULL,size INTEGER NOT NULL,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_image_deletions_user ON image_deletions(user_id);

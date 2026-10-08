ALTER TABLE users ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 1 CHECK (can_edit IN (0, 1));
CREATE INDEX idx_logs_created_at ON logs(created_at, id);

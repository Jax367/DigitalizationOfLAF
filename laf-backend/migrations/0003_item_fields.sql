-- Preserve previous fields for recovery; this archive has no live foreign keys.
CREATE TABLE _legacy_items_v03 AS SELECT * FROM items;
CREATE TABLE _migration_items_sequence AS SELECT seq FROM sqlite_sequence WHERE name = 'items';
DROP TABLE items;
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  floor TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK (status IN ('found', 'claimed')),
  image_id TEXT REFERENCES images(id) ON DELETE RESTRICT
);
INSERT INTO items (id, title, description, floor, created_at, status, image_id)
 SELECT id, title, description, location, COALESCE(created_at, CURRENT_TIMESTAMP), status, image_id FROM _legacy_items_v03;
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT MAX(seq) FROM _migration_items_sequence), 0)) WHERE name = 'items';
DROP TABLE _migration_items_sequence;
CREATE INDEX idx_items_image ON items(image_id);
CREATE INDEX idx_items_status ON items(status, id);
-- Lifecycle metadata is separate from the seven business fields.
CREATE TABLE item_claims (item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE, claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO item_claims (item_id, claimed_at) SELECT id, COALESCE(updated_at, CURRENT_TIMESTAMP) FROM _legacy_items_v03 WHERE status = 'claimed';
CREATE TRIGGER items_claim_insert AFTER INSERT ON items WHEN NEW.status = 'claimed'
 BEGIN INSERT INTO item_claims (item_id) VALUES (NEW.id); END;
CREATE TRIGGER items_claim_update AFTER UPDATE OF status ON items WHEN NEW.status = 'claimed' AND OLD.status <> 'claimed'
 BEGIN INSERT OR REPLACE INTO item_claims (item_id) VALUES (NEW.id); END;
CREATE TRIGGER items_unclaim_update AFTER UPDATE OF status ON items WHEN NEW.status = 'found'
 BEGIN DELETE FROM item_claims WHERE item_id = NEW.id; END;

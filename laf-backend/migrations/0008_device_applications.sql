CREATE TABLE device_applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 device_id TEXT NOT NULL REFERENCES reader_devices(id) ON DELETE CASCADE,
 account_id INTEGER NOT NULL REFERENCES reader_accounts(id) ON DELETE RESTRICT,
 display_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('pending','approved','rejected','superseded')) DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
 expires_at TEXT NOT NULL DEFAULT (datetime('now','+7 days')),
 reviewed_at TEXT,
 reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_applications_device ON device_applications(device_id,id);
CREATE INDEX idx_applications_account_time ON device_applications(account_id,created_at);
CREATE INDEX idx_applications_expiry ON device_applications(status,expires_at);
-- Recover available applications from the old audit log before falling back to
-- the original device creation time. Approved device identities stay intact.
INSERT INTO device_applications(device_id,account_id,display_name,status,created_at,expires_at,reviewed_at)
 SELECT d.id,COALESCE(json_extract(l.details,'$.account_id'),d.account_id),COALESCE(json_extract(l.details,'$.display_name'),d.display_name),
 CASE WHEN l.id=(SELECT MAX(id) FROM logs WHERE action='device.apply' AND target=l.target AND json_valid(details)) THEN CASE WHEN d.status='revoked' THEN 'superseded' ELSE d.status END ELSE 'superseded' END,
 l.created_at,datetime(l.created_at,'+7 days'),CASE WHEN l.id=(SELECT MAX(id) FROM logs WHERE action='device.apply' AND target=l.target AND json_valid(details)) THEN d.reviewed_at ELSE NULL END
 FROM logs l JOIN reader_devices d ON l.target='devices/'||d.id JOIN reader_accounts a ON a.id=COALESCE(json_extract(CASE WHEN json_valid(l.details) THEN l.details ELSE '{}' END,'$.account_id'),d.account_id)
 WHERE l.action='device.apply' AND json_valid(l.details) ORDER BY l.id;
INSERT INTO device_applications(device_id,account_id,display_name,status,created_at,expires_at,reviewed_at)
 SELECT id,account_id,display_name,CASE WHEN status='revoked' THEN 'superseded' ELSE status END,created_at,datetime(created_at,'+7 days'),reviewed_at FROM reader_devices d WHERE NOT EXISTS(SELECT 1 FROM device_applications WHERE device_id=d.id);
CREATE TRIGGER application_limits BEFORE INSERT ON device_applications BEGIN
 SELECT RAISE(ABORT,'device_apply_cooldown') WHERE EXISTS(SELECT 1 FROM device_applications WHERE device_id=NEW.device_id AND created_at>datetime('now','-5 minutes'));
 SELECT RAISE(ABORT,'device_apply_account_limit') WHERE (SELECT COUNT(*) FROM device_applications WHERE account_id=NEW.account_id AND created_at>datetime('now','-1 hour'))>=20 OR (SELECT COUNT(*) FROM device_applications WHERE account_id=NEW.account_id AND created_at>datetime('now','-1 day'))>=100;
END;
CREATE TRIGGER application_created AFTER INSERT ON device_applications BEGIN
 UPDATE device_applications SET status='superseded' WHERE device_id=NEW.device_id AND status='pending' AND id<>NEW.id;
 INSERT INTO logs(user_id,action,target,details) VALUES(NULL,'device.apply','device-applications/'||NEW.id,json_object('device_id',NEW.device_id,'account_id',NEW.account_id,'display_name',NEW.display_name,'created_at',NEW.created_at));
END;
CREATE TRIGGER application_reviewed AFTER UPDATE OF status ON device_applications
 WHEN OLD.status='pending' AND NEW.status IN('approved','rejected') BEGIN
 UPDATE reader_devices SET status=NEW.status,reviewed_at=NEW.reviewed_at WHERE id=NEW.device_id AND account_id=NEW.account_id AND status='pending' AND NEW.id=(SELECT MAX(id) FROM device_applications WHERE device_id=NEW.device_id);
 INSERT INTO logs(user_id,action,target,details) VALUES(NEW.reviewed_by,'device.review','devices/'||NEW.device_id,json_object('application_id',NEW.id,'before',OLD.status,'after',NEW.status));
END;

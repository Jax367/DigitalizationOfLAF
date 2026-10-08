CREATE TABLE upload_reservations (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),size INTEGER NOT NULL CHECK(size>=1 AND size<=5242880),expires_at INTEGER NOT NULL);
CREATE INDEX idx_upload_reservations_user ON upload_reservations(user_id);
CREATE INDEX idx_upload_reservations_expiry ON upload_reservations(expires_at);
CREATE TABLE upload_daily (user_id INTEGER NOT NULL REFERENCES users(id),day TEXT NOT NULL,count INTEGER NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(user_id,day));
CREATE TRIGGER upload_budget AFTER INSERT ON upload_reservations BEGIN INSERT INTO upload_daily(user_id,day,count,bytes) VALUES(NEW.user_id,date('now'),1,NEW.size) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1,bytes=bytes+NEW.size;END;
CREATE INDEX idx_images_uploader_size ON images(uploaded_by,size);
CREATE INDEX idx_auth_throttle_expiry ON auth_throttle(reset_at);
INSERT INTO upload_daily(user_id,day,count,bytes) SELECT uploaded_by,date(created_at),COUNT(*),SUM(size) FROM images WHERE uploaded_by IS NOT NULL AND date(created_at)>=date('now','-7 days') GROUP BY uploaded_by,date(created_at);

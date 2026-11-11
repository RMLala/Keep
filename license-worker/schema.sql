PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS licenses (
 id TEXT PRIMARY KEY, app_id TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE,
 license_type TEXT NOT NULL CHECK(license_type IN ('annual','lifetime','owner')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 expires_at TEXT, max_devices INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS devices (
 license_id TEXT NOT NULL REFERENCES licenses(id), device_hash TEXT NOT NULL,
 first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY(license_id,device_hash)
);
CREATE TABLE IF NOT EXISTS trials (
 app_id TEXT NOT NULL, device_hash TEXT NOT NULL, started_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, PRIMARY KEY(app_id,device_hash)
);
CREATE TABLE IF NOT EXISTS rate_limits (
 bucket TEXT NOT NULL, key_hash TEXT NOT NULL, window_start INTEGER NOT NULL,
 count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(bucket,key_hash,window_start)
);
CREATE INDEX IF NOT EXISTS idx_license_code_app ON licenses(app_id,code_hash);

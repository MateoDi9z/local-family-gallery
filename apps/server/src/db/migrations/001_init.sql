-- 001: esquema inicial (PLAN §3.1). Una migración aplicada nunca se edita: se crea otra.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
);

CREATE TABLE members (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  member_id    TEXT REFERENCES members(id),
  session_hash TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE api_tokens (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  token_hash TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE volumes (
  id         TEXT PRIMARY KEY,
  tier       TEXT NOT NULL CHECK (tier IN ('fast', 'bulk')),
  path       TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (tier, path)
);

CREATE TABLE batches (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  device_id   TEXT REFERENCES devices(id),
  source      TEXT NOT NULL CHECK (source IN ('web', 'share', 'shortcut', 'desktop')),
  created_at  TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE places (
  id           TEXT PRIMARY KEY,
  geoname_id   INTEGER NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  admin1       TEXT,
  country_code TEXT NOT NULL,
  lat          REAL NOT NULL,
  lon          REAL NOT NULL
);

CREATE TABLE trips (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  name_is_custom INTEGER NOT NULL DEFAULT 0,
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  cover_media_id TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE media (
  id                      TEXT PRIMARY KEY,
  sha256                  TEXT NOT NULL UNIQUE,
  partial_hash            TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  mime                    TEXT NOT NULL,
  size_bytes              INTEGER NOT NULL,
  original_name           TEXT NOT NULL,
  volume_id               TEXT NOT NULL REFERENCES volumes(id),
  original_path           TEXT NOT NULL, -- relativa al volumen
  member_id               TEXT NOT NULL REFERENCES members(id),
  batch_id                TEXT REFERENCES batches(id),
  uploaded_at             TEXT NOT NULL,
  file_modified_at        TEXT,          -- lastModified que mandó el cliente
  taken_at                TEXT,          -- ISO 8601 UTC
  taken_tz                TEXT,          -- offset original, ej. "+11:00"
  taken_at_source         TEXT CHECK (taken_at_source IN ('exif', 'quicktime', 'file', 'upload')),
  width                   INTEGER,
  height                  INTEGER,
  duration_ms             INTEGER,
  orientation             INTEGER,
  camera_make             TEXT,
  camera_model            TEXT,
  live_photo_id           TEXT,          -- ContentIdentifier de Apple (Fase 2: Live Photos)
  hdr                     INTEGER NOT NULL DEFAULT 0,
  lat                     REAL,
  lon                     REAL,
  location_source         TEXT CHECK (location_source IN ('gps', 'suggested', 'manual')),
  location_confirmed      INTEGER NOT NULL DEFAULT 0,
  suggested_from_media_id TEXT,
  suggestion_confidence   REAL,
  place_id                TEXT REFERENCES places(id),
  trip_id                 TEXT REFERENCES trips(id),
  phash                   TEXT,          -- dHash de 64 bits en hex
  status                  TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  error                   TEXT,
  deleted_at              TEXT           -- borrado explícito por un usuario: el original va a la papelera
);
CREATE INDEX media_partial ON media (size_bytes, partial_hash);
CREATE INDEX media_taken ON media (taken_at);
CREATE INDEX media_place ON media (place_id);
CREATE INDEX media_trip ON media (trip_id);
CREATE INDEX media_batch ON media (batch_id);

CREATE TABLE derivatives (
  media_id  TEXT NOT NULL REFERENCES media(id),
  variant   TEXT NOT NULL CHECK (variant IN ('thumb', 'preview', 'poster', 'video')),
  volume_id TEXT NOT NULL REFERENCES volumes(id),
  path      TEXT NOT NULL,
  mime      TEXT NOT NULL,
  width     INTEGER,
  height    INTEGER,
  bytes     INTEGER NOT NULL,
  PRIMARY KEY (media_id, variant)
);

CREATE TABLE favorites (
  member_id  TEXT NOT NULL REFERENCES members(id),
  media_id   TEXT NOT NULL REFERENCES media(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_id, media_id)
);

CREATE TABLE similar_pairs (
  id         TEXT PRIMARY KEY,
  media_a    TEXT NOT NULL REFERENCES media(id),
  media_b    TEXT NOT NULL REFERENCES media(id),
  distance   INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'kept_both', 'dismissed')),
  created_at TEXT NOT NULL,
  UNIQUE (media_a, media_b)
);

CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  media_id     TEXT,
  payload      TEXT NOT NULL DEFAULT '{}',
  priority     INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after    TEXT NOT NULL,
  locked_by    TEXT,
  locked_until TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX jobs_pick ON jobs (status, priority, run_after);
CREATE INDEX jobs_media ON jobs (media_id);

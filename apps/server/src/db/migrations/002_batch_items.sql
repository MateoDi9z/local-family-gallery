-- 002: qué archivos entraron en cada lote, incluidos los duplicados (para el resumen del lote).
CREATE TABLE batch_items (
  batch_id   TEXT NOT NULL REFERENCES batches(id),
  media_id   TEXT NOT NULL REFERENCES media(id),
  duplicate  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, media_id)
);
CREATE INDEX batch_items_media ON batch_items (media_id);

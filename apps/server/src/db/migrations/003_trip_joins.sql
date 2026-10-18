-- 003: viajes unidos a mano. Los viajes se recalculan desde cero con cada foto nueva (assign_trips), así que
-- la unión se guarda como regla: los grupos de fotos que caen en este rango de fechas son un solo viaje.
CREATE TABLE trip_joins (
  id         TEXT PRIMARY KEY,
  start_at   TEXT NOT NULL,
  end_at     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

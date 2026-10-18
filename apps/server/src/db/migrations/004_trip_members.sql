-- 004: quiénes fueron a un viaje, puesto a mano. Sin filas, se toman los que subieron fotos del viaje.
-- En cascada: los viajes se recalculan y un viaje que desaparece se lleva su lista.
CREATE TABLE trip_members (
  trip_id   TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  PRIMARY KEY (trip_id, member_id)
);

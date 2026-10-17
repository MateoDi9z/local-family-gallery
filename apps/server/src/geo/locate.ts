// Trabajos `geocode` y `suggest_location` (PLAN §5).
import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import type { Ctx } from "../context";
import { enqueue, enqueueDebounced } from "../jobs/enqueue";
import { loadCities } from "./cities";

const TWO_HOURS = 2 * 3600_000;
export const TRIPS_DEBOUNCE_MS = 30_000;

/** Lugar más cercano (cities500) → `places` (uno por geoname_id) → `media.place_id`. */
export async function geocode(ctx: Ctx, mediaId: string): Promise<void> {
  const m = ctx.db
    .query<{ lat: number | null; lon: number | null }, [string]>(
      "SELECT lat, lon FROM media WHERE id = ? AND deleted_at IS NULL",
    )
    .get(mediaId);
  if (!m || m.lat === null || m.lon === null) return;
  const index = await loadCities(ctx.config.geonamesPath);
  const hit = index.nearest(m.lat, m.lon);
  if (!hit) return;
  const c = hit.city;
  ctx.db.transaction(() => {
    ctx.db
      .query(
        `INSERT INTO places (id, geoname_id, name, admin1, country_code, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (geoname_id) DO NOTHING`,
      )
      .run(ulid(), c.geonameId, c.name, c.admin1 || null, c.countryCode, c.lat, c.lon);
    const place = ctx.db
      .query<{ id: string }, [number]>("SELECT id FROM places WHERE geoname_id = ?")
      .get(c.geonameId) as { id: string };
    // Solo si la ubicación no cambió mientras buscábamos (una corrección manual encola otro geocode).
    ctx.db
      .query("UPDATE media SET place_id = ? WHERE id = ? AND lat = ? AND lon = ?")
      .run(place.id, mediaId, m.lat, m.lon);
    enqueueDebounced(ctx.db, "assign_trips", TRIPS_DEBOUNCE_MS);
  })();
}

type Candidate = { id: string; lat: number; lon: number; taken_at: string };

/**
 * Foto con GPS de OTRO miembro con menor diferencia de `taken_at`, dentro de ±2 h.
 * Confianza = 1 − |Δt| / 2 h. Nunca queda confirmada sola. Si no hay, queda en "Sin ubicación".
 */
export function suggestLocation(db: Database, mediaId: string): boolean {
  const m = db
    .query<
      { member_id: string; taken_at: string | null; taken_at_source: string | null; lat: number | null },
      [string]
    >("SELECT member_id, taken_at, taken_at_source, lat FROM media WHERE id = ? AND deleted_at IS NULL")
    .get(mediaId);
  // Con la fecha de subida no hay con qué cruzar: sería la hora en que se subió, no la de la toma.
  if (!m || m.lat !== null || !m.taken_at || m.taken_at_source === "upload") return false;
  const t = new Date(m.taken_at).getTime();
  const best = db
    .query<Candidate, [string, string, string, string]>(
      `SELECT id, lat, lon, taken_at FROM media
       WHERE member_id != ? AND location_source = 'gps' AND lat IS NOT NULL AND deleted_at IS NULL
         AND taken_at BETWEEN ? AND ?
       ORDER BY abs(julianday(taken_at) - julianday(?)), id LIMIT 1`,
    )
    .get(m.member_id, new Date(t - TWO_HOURS).toISOString(), new Date(t + TWO_HOURS).toISOString(), m.taken_at);
  if (!best) return false;
  const confidence = Math.max(0, 1 - Math.abs(new Date(best.taken_at).getTime() - t) / TWO_HOURS);
  db.transaction(() => {
    const changed = db
      .query(
        `UPDATE media SET lat = ?, lon = ?, location_source = 'suggested', location_confirmed = 0,
           suggested_from_media_id = ?, suggestion_confidence = ?
         WHERE id = ? AND lat IS NULL`,
      )
      .run(best.lat, best.lon, best.id, confidence, mediaId).changes;
    if (changed) enqueue(db, "geocode", mediaId);
  })();
  return true;
}

/**
 * Llegó una foto con GPS: las fotos sin ubicación de OTROS miembros en ±2 h pueden recibir sugerencia ahora
 * (por ejemplo, si alguien subió las suyas antes).
 */
export function resuggestAround(db: Database, mediaId: string, memberId: string, takenAt: string): void {
  const t = new Date(takenAt).getTime();
  const ids = db
    .query<{ id: string }, [string, string, string]>(
      `SELECT id FROM media
       WHERE member_id != ? AND lat IS NULL AND deleted_at IS NULL AND taken_at_source != 'upload'
         AND taken_at BETWEEN ? AND ?`,
    )
    .all(memberId, new Date(t - TWO_HOURS).toISOString(), new Date(t + TWO_HOURS).toISOString());
  for (const { id } of ids) if (id !== mediaId) enqueue(db, "suggest_location", id);
}

// Trabajo `assign_trips` (PLAN §5): recalcula todos los viajes de una vez.
import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import { getSetting } from "../db";
import { localFromUtc } from "../media/exiftool";
import { texts } from "../media/texts";
import { distanceKm } from "./cities";

export const AWAY_KM = 30;
export const GAP_MS = 36 * 3600_000;
export const MIN_TRIP_MEDIA = 5;

export type TripPoint = { id: string; t: number; lat: number; lon: number };

/**
 * Agrupa en viajes las medias a más de 30 km de casa, ordenadas por fecha. Corta cuando pasan más de 36 h
 * sin medias lejos de casa o cuando aparece una media en casa entre medio. Descarta los de menos de 5.
 */
export function detectTrips(points: TripPoint[], home: { lat: number; lon: number }): TripPoint[][] {
  const sorted = [...points].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const trips: TripPoint[][] = [];
  let cur: TripPoint[] = [];
  const close = () => {
    if (cur.length >= MIN_TRIP_MEDIA) trips.push(cur);
    cur = [];
  };
  for (const p of sorted) {
    if (distanceKm(p.lat, p.lon, home.lat, home.lon) <= AWAY_KM) {
      close();
      continue;
    }
    const last = cur.at(-1);
    if (last && p.t - last.t > GAP_MS) close();
    cur.push(p);
  }
  close();
  return trips;
}

type Row = {
  id: string;
  taken_at: string;
  taken_tz: string | null;
  lat: number;
  lon: number;
  place_id: string | null;
  trip_id: string | null;
};
type TripRow = { id: string; name_is_custom: number; start_at: string; end_at: string };

/**
 * Aplica los viajes detectados. Para no romper links, cada viaje nuevo reutiliza el id del viaje existente
 * que más de sus medias ya tenían (o, si no, uno existente que se solape en fechas). Nunca pisa un nombre
 * custom. Los viajes que quedan vacíos se borran, salvo los de nombre custom (pueden volver a llenarse).
 */
export function assignTrips(db: Database): { trips: number } {
  const home = getSetting<{ lat: number; lon: number }>(db, "home");
  if (!home) return { trips: 0 };
  return db
    .transaction(() => {
      const rows = db
        .query<Row, []>(
          `SELECT id, taken_at, taken_tz, lat, lon, place_id, trip_id FROM media
           WHERE deleted_at IS NULL AND lat IS NOT NULL AND lon IS NOT NULL AND taken_at IS NOT NULL`,
        )
        .all();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const detected = detectTrips(
        rows.map((r) => ({ id: r.id, t: new Date(r.taken_at).getTime(), lat: r.lat, lon: r.lon })),
        home,
      );
      const existing = db.query<TripRow, []>("SELECT id, name_is_custom, start_at, end_at FROM trips").all();
      const existingById = new Map(existing.map((t) => [t.id, t]));
      const used = new Set<string>();
      const placeName = db.query<{ name: string }, [string]>("SELECT name FROM places WHERE id = ?");
      const now = new Date().toISOString();

      db.query("UPDATE media SET trip_id = NULL WHERE trip_id IS NOT NULL").run();
      const setTrip = db.query("UPDATE media SET trip_id = ? WHERE id = ?");

      for (const pts of detected) {
        const media = pts.map((p) => byId.get(p.id) as Row);
        const startAt = media[0]?.taken_at as string;
        const endAt = media.at(-1)?.taken_at as string;
        const id = pickTripId(media, startAt, endAt, existing, used) ?? ulid();
        used.add(id);

        // Nombre: el lugar con más medias + mes y año locales del comienzo.
        const counts = new Map<string, number>();
        for (const m of media) if (m.place_id) counts.set(m.place_id, (counts.get(m.place_id) ?? 0) + 1);
        const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
        const place = (top && placeName.get(top)?.name) || texts.tripWithoutPlace;
        const first = media[0] as Row;
        const local = localFromUtc(first.taken_at, first.taken_tz);
        const name = texts.tripName(place, local.getUTCMonth(), local.getUTCFullYear());

        const ids = media.map((m) => m.id);
        const ph = ids.map(() => "?").join(",");
        const fav = db
          .query<{ media_id: string }, string[]>(
            `SELECT media_id FROM favorites WHERE media_id IN (${ph}) ORDER BY created_at DESC LIMIT 1`,
          )
          .get(...ids);
        const cover = fav?.media_id ?? first.id;

        if (existingById.has(id)) {
          db.query(
            `UPDATE trips SET name = CASE WHEN name_is_custom = 1 THEN name ELSE ? END,
               start_at = ?, end_at = ?, cover_media_id = ? WHERE id = ?`,
          ).run(name, startAt, endAt, cover, id);
        } else {
          db.query(
            `INSERT INTO trips (id, name, name_is_custom, start_at, end_at, cover_media_id, created_at)
             VALUES (?, ?, 0, ?, ?, ?, ?)`,
          ).run(id, name, startAt, endAt, cover, now);
        }
        for (const m of ids) setTrip.run(id, m);
      }

      for (const t of existing) {
        if (used.has(t.id)) continue;
        if (t.name_is_custom) db.query("UPDATE trips SET cover_media_id = NULL WHERE id = ?").run(t.id);
        else db.query("DELETE FROM trips WHERE id = ?").run(t.id);
      }
      return { trips: detected.length };
    })
    .immediate();
}

function pickTripId(media: Row[], startAt: string, endAt: string, existing: TripRow[], used: Set<string>) {
  const votes = new Map<string, number>();
  for (const m of media) if (m.trip_id && !used.has(m.trip_id)) votes.set(m.trip_id, (votes.get(m.trip_id) ?? 0) + 1);
  const voted = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (voted && existing.some((t) => t.id === voted)) return voted;
  // Viaje custom vacío (o sin medias propias) que se solapa en fechas: se recupera con su nombre.
  return existing.find((t) => !used.has(t.id) && t.start_at <= endAt && t.end_at >= startAt)?.id;
}

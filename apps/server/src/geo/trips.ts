// Trabajo `assign_trips` (PLAN §5): recalcula todos los viajes de una vez.
import type { Database } from "bun:sqlite";
import { TRIP_GAP_MS } from "@lfg/shared";
import { ulid } from "ulid";
import { getSetting } from "../db";
import { localFromUtc } from "../media/exiftool";
import { texts } from "../media/texts";
import { distanceKm } from "./cities";

export const AWAY_KM = 30;
export const GAP_MS = TRIP_GAP_MS;
export const MIN_TRIP_MEDIA = 5;

export type TripPoint = { id: string; t: number; lat: number; lon: number };
/** Rango de un viaje unido a mano (`trip_joins`), en ms. */
export type TripJoin = { start: number; end: number };

/**
 * Agrupa en viajes las medias a más de 30 km de casa, ordenadas por fecha. Corta cuando pasan más de 36 h
 * sin medias lejos de casa o cuando aparece una media en casa entre medio. Los grupos que tocan un mismo
 * rango unido a mano quedan en un solo viaje. Al final descarta los de menos de 5.
 */
export function detectTrips(
  points: TripPoint[],
  home: { lat: number; lon: number },
  joins: TripJoin[] = [],
): TripPoint[][] {
  const sorted = [...points].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const groups: TripPoint[][] = [];
  let cur: TripPoint[] = [];
  const close = () => {
    if (cur.length) groups.push(cur);
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
  // Uniones a mano: un grupo se suma al anterior si los dos tocan el mismo rango.
  const touches = (g: TripPoint[], j: TripJoin) => (g[0]?.t ?? 0) <= j.end && (g.at(-1)?.t ?? 0) >= j.start;
  const joined: TripPoint[][] = [];
  for (const g of groups) {
    const prev = joined.at(-1);
    if (prev && joins.some((j) => touches(prev, j) && touches(g, j))) prev.push(...g);
    else joined.push(g);
  }
  return joined.filter((g) => g.length >= MIN_TRIP_MEDIA);
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
      const joins = db
        .query<{ start_at: string; end_at: string }, []>("SELECT start_at, end_at FROM trip_joins")
        .all()
        .map((j) => ({ start: Date.parse(j.start_at), end: Date.parse(j.end_at) }));
      const detected = detectTrips(
        rows.map((r) => ({ id: r.id, t: new Date(r.taken_at).getTime(), lat: r.lat, lon: r.lon })),
        home,
        joins,
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

/**
 * Une dos viajes: guarda el rango que los cubre (de los dos extremos) y recalcula. El nombre puesto a mano
 * se conserva (primero el de `keepId`). Devuelve el id del viaje que quedó, o null si alguno no existe.
 */
export function mergeTrips(db: Database, keepId: string, otherId: string): string | null {
  return db
    .transaction(() => {
      const q = db.query<TripRow & { name: string }, [string]>(
        "SELECT id, name, name_is_custom, start_at, end_at FROM trips WHERE id = ?",
      );
      const a = q.get(keepId);
      const b = q.get(otherId);
      if (!a || !b || a.id === b.id) return null;
      const anyMedia = db.query<{ id: string }, [string]>(
        "SELECT id FROM media WHERE trip_id = ? AND deleted_at IS NULL LIMIT 1",
      );
      const witness = anyMedia.get(a.id) ?? anyMedia.get(b.id);
      // Quiénes fueron: si alguno lo tenía puesto a mano, el unido queda con los de los dos.
      const manual = db.query<{ member_id: string }, [string]>("SELECT member_id FROM trip_members WHERE trip_id = ?");
      const uploaders = db.query<{ member_id: string }, [string]>(
        "SELECT DISTINCT member_id FROM media WHERE trip_id = ? AND deleted_at IS NULL",
      );
      const effective = (id: string) => {
        const m = manual.all(id);
        return (m.length ? m : uploaders.all(id)).map((r) => r.member_id);
      };
      const people =
        manual.all(a.id).length || manual.all(b.id).length ? new Set([...effective(a.id), ...effective(b.id)]) : null;
      db.query("INSERT INTO trip_joins (id, start_at, end_at, created_at) VALUES (?, ?, ?, ?)").run(
        ulid(),
        a.start_at < b.start_at ? a.start_at : b.start_at,
        a.end_at > b.end_at ? a.end_at : b.end_at,
        new Date().toISOString(),
      );
      assignTrips(db);
      const merged = witness
        ? db.query<{ trip_id: string | null }, [string]>("SELECT trip_id FROM media WHERE id = ?").get(witness.id)
            ?.trip_id
        : null;
      if (!merged) return null;
      const custom = a.name_is_custom ? a.name : b.name_is_custom ? b.name : null;
      if (custom) db.query("UPDATE trips SET name = ?, name_is_custom = 1 WHERE id = ?").run(custom, merged);
      if (people) {
        db.query("DELETE FROM trip_members WHERE trip_id = ?").run(merged);
        const add = db.query("INSERT INTO trip_members (trip_id, member_id) VALUES (?, ?)");
        for (const m of people) add.run(merged, m);
      }
      // El otro, si quedó vacío (los de nombre a mano no se borran solos), ya es parte de este.
      for (const id of [a.id, b.id])
        if (id !== merged)
          db.query("DELETE FROM trips WHERE id = ? AND NOT EXISTS (SELECT 1 FROM media WHERE trip_id = ?)").run(id, id);
      return merged;
    })
    .immediate();
}

/** Deshace las uniones que tocan este viaje y recalcula. false si el viaje no existe. */
export function splitTrip(db: Database, id: string): boolean {
  return db
    .transaction(() => {
      const t = db
        .query<TripRow, [string]>("SELECT id, name_is_custom, start_at, end_at FROM trips WHERE id = ?")
        .get(id);
      if (!t) return false;
      db.query("DELETE FROM trip_joins WHERE start_at <= ? AND end_at >= ?").run(t.end_at, t.start_at);
      assignTrips(db);
      return true;
    })
    .immediate();
}

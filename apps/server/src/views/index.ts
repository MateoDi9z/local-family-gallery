// Área medios: rutas de lectura (/home, /places, /trips, /media*), bandejas, /admin/status y /events.
// Siempre se excluye lo borrado (`deleted_at`). Entradas validadas con los zod de @lfg/shared.
import type { Database } from "bun:sqlite";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AdminStatus,
  endpoints,
  fileUrl,
  type HomeResponse,
  Id,
  LocationBulk,
  LocationPatch,
  MediaListQuery,
  type ServerEvent,
  SimilarAction,
  type Trip,
  TripPatch,
} from "@lfg/shared";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ulid } from "ulid";
import type { AppEnv, Ctx } from "../context";
import { getSetting } from "../db";
import { enqueue, enqueueDebounced } from "../jobs/enqueue";
import { texts } from "../media/texts";
import { MEDIA_COLUMNS, type MediaRow, toMediaItems } from "../media-item";
import { getVolume, listVolumes, volumeUsage } from "../storage";
import { CRITICAL_JOBS } from "../worker/queue";

export type ViewOptions = { now?: () => Date; eventsIntervalMs?: number };

type TripRow = {
  id: string;
  name: string;
  name_is_custom: number;
  start_at: string;
  end_at: string;
  count: number;
  cover_sha: string | null;
};

const TRIP_SELECT = `SELECT t.id, t.name, t.name_is_custom, t.start_at, t.end_at,
  (SELECT count(*) FROM media x WHERE x.trip_id = t.id AND x.deleted_at IS NULL) AS count,
  COALESCE(
    (SELECT cm.sha256 FROM media cm JOIN derivatives d ON d.media_id = cm.id AND d.variant = 'thumb'
      WHERE cm.id = t.cover_media_id AND cm.deleted_at IS NULL),
    (SELECT cm.sha256 FROM media cm JOIN derivatives d ON d.media_id = cm.id AND d.variant = 'thumb'
      WHERE cm.trip_id = t.id AND cm.deleted_at IS NULL ORDER BY cm.taken_at LIMIT 1)
  ) AS cover_sha
  FROM trips t`;

const toTrip = (r: TripRow): Trip => ({
  id: r.id,
  name: r.name,
  nameIsCustom: r.name_is_custom === 1,
  startAt: r.start_at,
  endAt: r.end_at,
  count: r.count,
  coverThumbUrl: r.cover_sha ? fileUrl(r.cover_sha, "thumb") : null,
});

type PlaceRow = {
  id: string;
  name: string;
  admin1: string | null;
  country_code: string;
  lat: number;
  lon: number;
  count: number;
  cover_sha: string | null;
};
const PLACE_SELECT = `SELECT p.id, p.name, p.admin1, p.country_code, p.lat, p.lon, count(m.id) AS count,
  (SELECT cm.sha256 FROM media cm JOIN derivatives d ON d.media_id = cm.id AND d.variant = 'thumb'
    WHERE cm.place_id = p.id AND cm.deleted_at IS NULL
    ORDER BY COALESCE(cm.taken_at, cm.uploaded_at) DESC LIMIT 1) AS cover_sha
  FROM places p JOIN media m ON m.place_id = p.id AND m.deleted_at IS NULL`;
const toPlace = (r: PlaceRow) => ({
  id: r.id,
  name: r.name,
  admin1: r.admin1,
  countryCode: r.country_code,
  lat: r.lat,
  lon: r.lon,
  count: r.count,
  coverThumbUrl: r.cover_sha ? fileUrl(r.cover_sha, "thumb") : null,
});

const SORT_KEY = "COALESCE(m.taken_at, m.uploaded_at)";
const NO_LOCATION = "(m.lat IS NULL OR (m.location_source = 'suggested' AND m.location_confirmed = 0))";
const ALIVE = "m.deleted_at IS NULL";

const encodeCursor = (k: string, id: string) => Buffer.from(JSON.stringify([k, id])).toString("base64url");
function decodeCursor(s: string): [string, string] | null {
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString());
    return Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string" ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

const notFound = (c: Context<AppEnv>, message = texts.http.notFound) => c.json({ error: "not_found", message }, 404);
const memberRequired = (c: Context<AppEnv>) =>
  c.json({ error: "member_required", message: texts.http.memberRequired }, 409);

/** Ubicación manual (confirmada): limpia la sugerencia, re-geocodifica y recalcula viajes. */
function setManualLocation(db: Database, ids: string[], lat: number, lon: number): number {
  return db.transaction(() => {
    const upd = db.query(
      `UPDATE media SET lat = ?, lon = ?, location_source = 'manual', location_confirmed = 1,
         suggested_from_media_id = NULL, suggestion_confidence = NULL
       WHERE id = ? AND deleted_at IS NULL`,
    );
    let n = 0;
    for (const id of new Set(ids)) {
      if (upd.run(lat, lon, id).changes) {
        n++;
        enqueue(db, "geocode", id);
      }
    }
    if (n) enqueueDebounced(db, "assign_trips", 30_000);
    return n;
  })();
}

function queueCounts(db: Database) {
  const rows = db
    .query<{ type: string; status: string; n: number }, []>(
      "SELECT type, status, count(*) AS n FROM jobs WHERE status IN ('queued', 'running', 'failed') GROUP BY type, status",
    )
    .all();
  const q: AdminStatus["queue"] = { queued: 0, running: 0, failed: 0, byType: {} };
  for (const r of rows) {
    if (r.status === "failed") {
      q.failed += r.n;
      continue;
    }
    const t = q.byType[r.type] ?? { queued: 0, running: 0 };
    q.byType[r.type] = t;
    if (r.status === "queued") {
      q.queued += r.n;
      t.queued += r.n;
    } else {
      q.running += r.n;
      t.running += r.n;
    }
  }
  return q;
}

export function viewRoutes(ctx: Ctx, opts: ViewOptions = {}) {
  const { db } = ctx;
  const now = opts.now ?? (() => new Date());
  const app = new Hono<AppEnv>();
  const items = (c: Context<AppEnv>, rows: MediaRow[]) => toMediaItems(db, rows, c.get("memberId"));
  const mediaById = (id: string) =>
    db.query<MediaRow, [string]>(`SELECT ${MEDIA_COLUMNS} FROM media m WHERE m.id = ? AND ${ALIVE}`).get(id);
  const tripById = (id: string) => db.query<TripRow, [string]>(`${TRIP_SELECT} WHERE t.id = ?`).get(id);

  // ── Portada ──────────────────────────────────────────────────────
  app.get(endpoints.home, (c) => {
    const today = now();
    const md = today.toISOString().slice(5, 10);
    const year = today.getUTCFullYear();
    // Fecha local de la toma (UTC + su offset). Las que solo tienen fecha de subida no cuentan.
    const local = "m.taken_at, COALESCE(m.taken_tz, '+00:00')";
    const rows = db
      .query<MediaRow & { y: string }, [string, string]>(
        `SELECT ${MEDIA_COLUMNS}, strftime('%Y', ${local}) AS y FROM media m
         WHERE ${ALIVE} AND m.taken_at IS NOT NULL AND m.taken_at_source != 'upload'
           AND strftime('%m-%d', ${local}) = ? AND strftime('%Y', ${local}) < ?
         ORDER BY y DESC, m.taken_at LIMIT 300`,
      )
      .all(md, String(year));
    const all = items(c, rows);
    const groups = new Map<number, typeof all>();
    rows.forEach((r, i) => {
      const ago = year - Number(r.y);
      groups.set(ago, [...(groups.get(ago) ?? []), all[i] as (typeof all)[number]]);
    });
    const last = db.query<TripRow, []>(`${TRIP_SELECT} WHERE count > 0 ORDER BY t.end_at DESC LIMIT 1`).get();
    const body: HomeResponse = {
      galleryName: getSetting<string>(db, "gallery_name") ?? texts.defaultGalleryName,
      onThisDay: [...groups].map(([yearsAgo, media]) => ({ yearsAgo, media })),
      lastTrip: last
        ? {
            trip: toTrip(last),
            perMember: db
              .query<{ memberId: string; count: number }, [string]>(
                `SELECT member_id AS memberId, count(*) AS count FROM media
                 WHERE trip_id = ? AND deleted_at IS NULL GROUP BY member_id ORDER BY count DESC`,
              )
              .all(last.id),
          }
        : null,
    };
    return c.json(body);
  });

  // ── Lugares ──────────────────────────────────────────────────────
  app.get(endpoints.places, (c) =>
    c.json(db.query<PlaceRow, []>(`${PLACE_SELECT} GROUP BY p.id ORDER BY count DESC`).all().map(toPlace)),
  );

  app.get("/places/:id", (c) => {
    const id = Id.parse(c.req.param("id"));
    const place = db.query<PlaceRow, [string]>(`${PLACE_SELECT} WHERE p.id = ? GROUP BY p.id`).get(id);
    if (!place) return notFound(c, texts.http.placeNotFound);
    const rows = db
      .query<MediaRow & { k: string }, [string]>(
        `SELECT ${MEDIA_COLUMNS}, ${SORT_KEY} AS k FROM media m WHERE m.place_id = ? AND ${ALIVE}
         ORDER BY k DESC, m.id DESC`,
      )
      .all(id);
    const all = items(c, rows);
    // Grupos por viaje (y `trip: null` para las sueltas), del más reciente al más viejo.
    const groups = new Map<string | null, typeof all>();
    for (const m of all) groups.set(m.tripId, [...(groups.get(m.tripId) ?? []), m]);
    return c.json({
      place: toPlace(place),
      groups: [...groups].map(([tripId, media]) => {
        const t = tripId ? tripById(tripId) : null;
        // Dentro de un viaje, en orden cronológico; las sueltas, más recientes primero.
        return { trip: t ? toTrip(t) : null, media: t ? media.reverse() : media };
      }),
    });
  });

  // ── Viajes ───────────────────────────────────────────────────────
  app.get(endpoints.trips, (c) =>
    c.json(db.query<TripRow, []>(`${TRIP_SELECT} WHERE count > 0 ORDER BY t.start_at DESC`).all().map(toTrip)),
  );

  app.get("/trips/:id", (c) => {
    const t = tripById(Id.parse(c.req.param("id")));
    if (!t?.count) return notFound(c, texts.http.tripNotFound);
    const rows = db
      .query<MediaRow, [string]>(
        `SELECT ${MEDIA_COLUMNS} FROM media m WHERE m.trip_id = ? AND ${ALIVE} ORDER BY m.taken_at, m.id`,
      )
      .all(t.id);
    return c.json({ trip: toTrip(t), media: items(c, rows) });
  });

  app.patch("/trips/:id", async (c) => {
    const id = Id.parse(c.req.param("id"));
    const { name } = TripPatch.parse(await c.req.json());
    if (!db.query("UPDATE trips SET name = ?, name_is_custom = 1 WHERE id = ?").run(name, id).changes)
      return notFound(c, texts.http.tripNotFound);
    return c.json(toTrip(tripById(id) as TripRow));
  });

  // ── Medias ───────────────────────────────────────────────────────
  app.get(endpoints.media, (c) => {
    const q = MediaListQuery.parse(c.req.query());
    const where = [ALIVE];
    const params: (string | number)[] = [];
    for (const [col, v] of [
      ["m.place_id", q.placeId],
      ["m.trip_id", q.tripId],
      ["m.member_id", q.memberId],
    ] as const) {
      if (!v) continue;
      where.push(`${col} = ?`);
      params.push(v);
    }
    if (q.noLocation === "1") where.push(NO_LOCATION);
    if (q.favorites === "1") {
      const me = c.get("memberId");
      if (!me) return memberRequired(c);
      where.push("m.id IN (SELECT media_id FROM favorites WHERE member_id = ?)");
      params.push(me);
    }
    if (q.cursor) {
      const cur = decodeCursor(q.cursor);
      if (!cur) return c.json({ error: "invalid", message: texts.http.badCursor }, 400);
      where.push(`(${SORT_KEY} < ? OR (${SORT_KEY} = ? AND m.id < ?))`);
      params.push(cur[0], cur[0], cur[1]);
    }
    const rows = db
      .query<MediaRow & { k: string }, (string | number)[]>(
        `SELECT ${MEDIA_COLUMNS}, ${SORT_KEY} AS k FROM media m WHERE ${where.join(" AND ")}
         ORDER BY k DESC, m.id DESC LIMIT ?`,
      )
      .all(...params, q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return c.json({
      items: items(c, page),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.k, last.id) : null,
    });
  });

  app.get("/media/:id", (c) => {
    const row = mediaById(Id.parse(c.req.param("id")));
    return row ? c.json(items(c, [row])[0]) : notFound(c);
  });

  app.patch("/media/:id/location", async (c) => {
    const id = Id.parse(c.req.param("id"));
    const { lat, lon } = LocationPatch.parse(await c.req.json());
    if (!setManualLocation(db, [id], lat, lon)) return notFound(c);
    return c.json(items(c, [mediaById(id) as MediaRow])[0]);
  });

  // También sirve para confirmar sugerencias en lote (se mandan las mismas coordenadas).
  app.post(endpoints.mediaLocationBulk, async (c) => {
    const { mediaIds, lat, lon } = LocationBulk.parse(await c.req.json());
    return c.json({ updated: setManualLocation(db, mediaIds, lat, lon) });
  });

  const favorite = (on: boolean) => (c: Context<AppEnv>) => {
    const id = Id.parse(c.req.param("id"));
    const me = c.get("memberId");
    if (!me) return memberRequired(c);
    const row = mediaById(id);
    if (!row) return notFound(c);
    if (on)
      db.query("INSERT INTO favorites (member_id, media_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(
        me,
        id,
        new Date().toISOString(),
      );
    else db.query("DELETE FROM favorites WHERE member_id = ? AND media_id = ?").run(me, id);
    if (row.trip_id) enqueueDebounced(db, "assign_trips", 30_000); // la portada del viaje es la favorita más reciente
    return c.json(items(c, [row])[0]);
  };
  app.post("/media/:id/favorite", favorite(true));
  app.delete("/media/:id/favorite", favorite(false));

  // Borrado EXPLÍCITO de un usuario: el original va a `<disco>/papelera/<misma ruta>` (rename, mismo disco),
  // se borran sus derivados (se pueden regenerar) y se marca `deleted_at`. Nada se borra solo.
  app.delete("/media/:id", async (c) => {
    const id = Id.parse(c.req.param("id"));
    const m = db
      .query<{ volume_id: string; original_path: string }, [string]>(
        "SELECT volume_id, original_path FROM media WHERE id = ? AND deleted_at IS NULL",
      )
      .get(id);
    if (!m) return notFound(c);
    const vol = getVolume(db, m.volume_id).path;
    let trashRel = join("papelera", m.original_path);
    if (await Bun.file(join(vol, trashRel)).exists()) trashRel = `${trashRel}.${ulid()}`;
    const src = join(vol, m.original_path);
    const dst = join(vol, trashRel);
    await mkdir(dirname(dst), { recursive: true });
    let moved = true;
    try {
      await rename(src, dst);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      moved = false; // el original ya no estaba: se marca igual
      ctx.log.warn("borrar: el original no estaba en el disco", { mediaId: id });
    }
    const derivs = db
      .query<{ volume_id: string; path: string }, [string]>(
        "SELECT volume_id, path FROM derivatives WHERE media_id = ?",
      )
      .all(id);
    try {
      db.transaction(() => {
        db.query("UPDATE media SET deleted_at = ?, original_path = ?, trip_id = NULL WHERE id = ?").run(
          new Date().toISOString(),
          moved ? trashRel : m.original_path,
          id,
        );
        db.query("DELETE FROM derivatives WHERE media_id = ?").run(id);
        db.query("DELETE FROM similar_pairs WHERE status = 'pending' AND (media_a = ? OR media_b = ?)").run(id, id);
        db.query("UPDATE jobs SET status = 'done', updated_at = ? WHERE media_id = ? AND status = 'queued'").run(
          new Date().toISOString(),
          id,
        );
        enqueueDebounced(db, "assign_trips", 30_000);
      })();
    } catch (e) {
      if (moved) await rename(dst, src); // la base no cambió: el original vuelve a su lugar
      throw e;
    }
    for (const d of derivs) await rm(join(getVolume(db, d.volume_id).path, d.path), { force: true });
    return c.body(null, 204);
  });

  // ── Bandejas ─────────────────────────────────────────────────────
  app.get(endpoints.inboxNoLocation, (c) => {
    const rows = db
      .query<
        MediaRow & {
          suggested_from_media_id: string | null;
          suggestion_confidence: number | null;
          place_name: string | null;
        },
        []
      >(
        `SELECT ${MEDIA_COLUMNS}, m.suggested_from_media_id, m.suggestion_confidence, p.name AS place_name
         FROM media m LEFT JOIN places p ON p.id = m.place_id
         WHERE ${ALIVE} AND ${NO_LOCATION}
         ORDER BY ${SORT_KEY} DESC, m.id DESC LIMIT 1000`,
      )
      .all();
    const media = items(c, rows);
    return c.json({
      items: rows.map((r, i) => ({
        media: media[i],
        suggestion:
          r.location_source === "suggested" && r.lat !== null && r.lon !== null && r.suggested_from_media_id
            ? {
                lat: r.lat,
                lon: r.lon,
                placeName: r.place_name,
                fromMediaId: r.suggested_from_media_id,
                confidence: r.suggestion_confidence ?? 0,
              }
            : null,
      })),
    });
  });

  app.get(endpoints.inboxSimilar, (c) => {
    const pairs = db
      .query<{ id: string; media_a: string; media_b: string; distance: number }, []>(
        `SELECT sp.id, sp.media_a, sp.media_b, sp.distance FROM similar_pairs sp
         JOIN media a ON a.id = sp.media_a AND a.deleted_at IS NULL
         JOIN media b ON b.id = sp.media_b AND b.deleted_at IS NULL
         WHERE sp.status = 'pending' ORDER BY sp.created_at DESC, sp.id LIMIT 500`,
      )
      .all();
    const ids = [...new Set(pairs.flatMap((p) => [p.media_a, p.media_b]))];
    const rows = ids.length
      ? db
          .query<MediaRow, string[]>(
            `SELECT ${MEDIA_COLUMNS} FROM media m WHERE m.id IN (${ids.map(() => "?").join(",")})`,
          )
          .all(...ids)
      : [];
    const byId = new Map(items(c, rows).map((m) => [m.id, m]));
    return c.json({
      items: pairs.map((p) => ({ id: p.id, a: byId.get(p.media_a), b: byId.get(p.media_b), distance: p.distance })),
    });
  });

  app.post("/inbox/similar/:id", async (c) => {
    const id = Id.parse(c.req.param("id"));
    const { action } = SimilarAction.parse(await c.req.json());
    if (!db.query("UPDATE similar_pairs SET status = ? WHERE id = ?").run(action, id).changes)
      return notFound(c, texts.http.pairNotFound);
    return c.body(null, 204);
  });

  // ── Administración ───────────────────────────────────────────────
  app.get(endpoints.adminStatus, async (c) => {
    const errors = db
      .query<{ id: string; media_id: string | null; type: string; last_error: string | null; updated_at: string }, []>(
        "SELECT id, media_id, type, last_error, updated_at FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 50",
      )
      .all();
    const volumes = await Promise.all(
      listVolumes(db).map(async (v) => {
        const u = await volumeUsage(v.path);
        return { id: v.id, tier: v.tier, path: v.path, ...u, alert: u.usedPercent > ctx.config.diskAlertPercent };
      }),
    );
    const gpu = getSetting<{ nvenc: boolean }>(db, "gpu");
    const body: AdminStatus = {
      queue: queueCounts(db),
      errors: errors.map((e) => ({
        jobId: e.id,
        mediaId: e.media_id,
        type: e.type,
        error: e.last_error ?? "",
        at: e.updated_at,
      })),
      volumes,
      gpu: gpu ? { nvenc: gpu.nvenc } : null,
    };
    return c.json(body);
  });

  app.post(endpoints.adminRetryFailed, (c) => {
    const at = new Date().toISOString();
    const critical = [...CRITICAL_JOBS];
    const retried = db.transaction(() => {
      db.query(
        `UPDATE media SET status = 'processing', error = NULL WHERE status = 'error' AND id IN
           (SELECT media_id FROM jobs WHERE status = 'failed' AND type IN (${critical.map(() => "?").join(",")}))`,
      ).run(...critical);
      return db
        .query(
          "UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, last_error = NULL, updated_at = ? WHERE status = 'failed'",
        )
        .run(at, at).changes;
    })();
    return c.json({ retried });
  });

  // ── Progreso (SSE) ───────────────────────────────────────────────
  app.get(endpoints.events, (c) =>
    streamSSE(c, async (stream) => {
      let open = true;
      stream.onAbort(() => {
        open = false;
      });
      let since = new Date().toISOString();
      const finished = db.query<
        { type: string; media_id: string; status: "processing" | "ready" | "error" },
        [string, string]
      >(
        `SELECT j.type, j.media_id, m.status FROM jobs j JOIN media m ON m.id = j.media_id
         WHERE j.status IN ('done', 'failed') AND j.updated_at > ? AND j.updated_at <= ?
         ORDER BY j.updated_at`,
      );
      while (open) {
        const until = new Date().toISOString();
        const events: ServerEvent[] = finished
          .all(since, until)
          .map((r) => ({ type: "media", mediaId: r.media_id, status: r.status, step: r.type }));
        since = until;
        const q = queueCounts(db);
        // El evento `queue` de cada tick hace también de keepalive.
        events.push({ type: "queue", queued: q.queued, running: q.running });
        for (const e of events) await stream.writeSSE({ data: JSON.stringify(e) });
        await stream.sleep(opts.eventsIntervalMs ?? 1500);
      }
    }),
  );

  return app;
}

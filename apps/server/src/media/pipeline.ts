// Trabajos de medios (PLAN §3.2): metadata, miniatura, versión mediana, poster, video, dHash y parecidos.
// Los originales nunca se tocan (solo se renombran dentro del mismo disco). Ningún derivado lleva metadata.
import type { Database } from "bun:sqlite";
import { link, mkdir, rename, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { ulid } from "ulid";
import type { Ctx } from "../context";
import { resuggestAround } from "../geo/locate";
import { enqueue } from "../jobs/enqueue";
import { derivativeRelPath, fastVolume, getVolume, originalRelPath, videoRelPath } from "../storage";
import { run } from "./exec";
import type { ExifTool, TakenAt } from "./exiftool";
import { parseMeta } from "./exiftool";
import { dhash, hamming, hashToHex, nearlyConstant, webpThumbnail } from "./images";
import { extractFrame, probe, transcodeArgs } from "./video";

export type JobEnv = { ctx: Ctx; exif: ExifTool; nvenc: boolean; signal?: AbortSignal };

type MediaFull = {
  id: string;
  kind: "photo" | "video";
  sha256: string;
  volume_id: string;
  original_path: string;
  member_id: string;
  member_name: string;
  uploaded_at: string;
  file_modified_at: string | null;
  taken_at: string | null;
  taken_tz: string | null;
  duration_ms: number | null;
  hdr: number;
  phash: string | null;
};

function loadMedia(db: Database, id: string): MediaFull | null {
  return db
    .query<MediaFull, [string]>(
      `SELECT m.id, m.kind, m.sha256, m.volume_id, m.original_path, m.member_id, mb.name AS member_name,
         m.uploaded_at, m.file_modified_at, m.taken_at, m.taken_tz, m.duration_ms, m.hdr, m.phash
       FROM media m JOIN members mb ON mb.id = m.member_id
       WHERE m.id = ? AND m.deleted_at IS NULL`,
    )
    .get(id);
}

const originalAbs = (db: Database, m: MediaFull) => join(getVolume(db, m.volume_id).path, m.original_path);

/** `file_modified_at` puede venir como ISO o como ms desde epoch (el `lastModified` del cliente). */
function fileDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(/^\d+$/.test(v) ? Number(v) : v);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1970 ? null : d;
}

// ── extract_metadata ───────────────────────────────────────────────

export async function extractMetadata(env: JobEnv, mediaId: string): Promise<void> {
  const { db, log } = env.ctx;
  const m = loadMedia(db, mediaId);
  if (!m) return;
  const abs = originalAbs(db, m);
  const meta = parseMeta(await env.exif.read(abs), m.kind);
  const video = m.kind === "video" ? await probe(abs, { signal: env.signal }) : null;

  let taken: TakenAt;
  let source: "exif" | "quicktime" | "file" | "upload";
  if (meta.taken) {
    taken = meta.taken;
    source = m.kind === "photo" ? "exif" : "quicktime";
  } else {
    const f = fileDate(m.file_modified_at);
    const d = f ?? new Date(m.uploaded_at);
    taken = { utc: d.toISOString(), tz: null, local: d };
    source = f ? "file" : "upload";
  }

  // Nombre legible con la fecha real (hora local de la toma). Hard link + borrar el viejo: atómico, sin
  // pisar nada que exista y sin tocar los bytes.
  const volPath = getVolume(db, m.volume_id).path;
  const newRel = originalRelPath(taken.local, m.member_name, m.sha256, extname(m.original_path));
  let renamedFrom: string | null = null;
  if (newRel !== m.original_path && (await linkNoClobber(join(volPath, m.original_path), join(volPath, newRel)))) {
    renamedFrom = m.original_path;
  }
  const hasGps = meta.lat !== null && meta.lon !== null;

  try {
    db.transaction(() => {
      db.query(
        `UPDATE media SET taken_at = ?, taken_tz = ?, taken_at_source = ?, width = ?, height = ?, duration_ms = ?,
           orientation = ?, camera_make = ?, camera_model = ?, live_photo_id = ?, hdr = ?, original_path = ?
         WHERE id = ?`,
      ).run(
        taken.utc,
        taken.tz,
        source,
        video?.width ?? meta.width,
        video?.height ?? meta.height,
        video?.durationMs ?? null,
        meta.orientation,
        meta.cameraMake,
        meta.cameraModel,
        meta.liveId,
        video?.hdr ? 1 : 0,
        renamedFrom ? newRel : m.original_path,
        m.id,
      );
      // Un GPS del archivo nunca pisa una ubicación manual.
      if (hasGps)
        db.query(
          `UPDATE media SET lat = ?, lon = ?, location_source = 'gps', location_confirmed = 1,
             suggested_from_media_id = NULL, suggestion_confidence = NULL
           WHERE id = ? AND (location_source IS NULL OR location_source != 'manual')`,
        ).run(meta.lat, meta.lon, m.id);
      enqueue(db, m.kind === "photo" ? "thumb" : "video_poster", m.id);
      enqueue(db, hasGps ? "geocode" : "suggest_location", m.id);
      if (hasGps && source !== "upload") resuggestAround(db, m.id, m.member_id, taken.utc);
    })();
  } catch (e) {
    if (renamedFrom) await unlink(join(volPath, newRel)).catch(() => {});
    throw e;
  }
  if (renamedFrom) await unlink(join(volPath, renamedFrom));
  log.debug("metadata", { mediaId, source, gps: hasGps });
}

/** true si `dest` quedó apuntando al mismo archivo que `src`. Nunca sobreescribe otro archivo. */
async function linkNoClobber(src: string, dest: string): Promise<boolean> {
  await mkdir(dirname(dest), { recursive: true });
  try {
    await link(src, dest);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      // Reintento después de un corte: el link ya estaba hecho.
      const [a, b] = await Promise.all([stat(src), stat(dest)]);
      return a.ino === b.ino && a.dev === b.dev;
    }
    if (code === "EPERM" || code === "ENOTSUP" || code === "EXDEV") return false; // el disco no soporta links
    throw e;
  }
}

// ── Derivados ──────────────────────────────────────────────────────

/** Escribe un derivado a un temporal en la misma carpeta y lo publica con rename. */
async function withTemp<T>(dest: string, ext: string, make: (tmp: string) => Promise<T>): Promise<T> {
  await mkdir(dirname(dest), { recursive: true });
  // La extensión importa: vips elige el formato por ella.
  const tmp = join(dirname(dest), `.${basename(dest)}.${ulid()}.tmp.${ext}`);
  try {
    const r = await make(tmp);
    await rename(tmp, dest);
    return r;
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

function saveDerivative(
  db: Database,
  mediaId: string,
  variant: "thumb" | "preview" | "poster" | "video",
  volumeId: string,
  rel: string,
  mime: string,
  dims: { width: number | null; height: number | null },
  bytes: number,
) {
  db.query(
    `INSERT INTO derivatives (media_id, variant, volume_id, path, mime, width, height, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (media_id, variant) DO UPDATE SET volume_id = excluded.volume_id, path = excluded.path,
       mime = excluded.mime, width = excluded.width, height = excluded.height, bytes = excluded.bytes`,
  ).run(mediaId, variant, volumeId, rel, mime, dims.width, dims.height, bytes);
}

async function webpDerivative(
  env: JobEnv,
  m: MediaFull,
  input: string,
  variant: "thumb" | "preview" | "poster",
  size: string,
) {
  const fast = fastVolume(env.ctx.db);
  const rel = derivativeRelPath(m.sha256, variant);
  const dest = join(fast.path, rel);
  const dims = await withTemp(dest, "webp", (tmp) => webpThumbnail(input, tmp, size, { signal: env.signal }));
  saveDerivative(env.ctx.db, m.id, variant, fast.id, rel, "image/webp", dims, Bun.file(dest).size);
}

const THUMB_SIZE = "400x";
const PREVIEW_SIZE = "2048>"; // caja de 2048, sin agrandar las chicas

export async function thumb(env: JobEnv, mediaId: string): Promise<void> {
  const { db } = env.ctx;
  const m = loadMedia(db, mediaId);
  if (m?.kind !== "photo") return;
  await webpDerivative(env, m, originalAbs(db, m), "thumb", THUMB_SIZE);
  db.transaction(() => {
    db.query("UPDATE media SET status = 'ready', error = NULL WHERE id = ?").run(m.id);
    enqueue(db, "preview", m.id);
    enqueue(db, "phash", m.id);
  })();
}

export async function preview(env: JobEnv, mediaId: string): Promise<void> {
  const m = loadMedia(env.ctx.db, mediaId);
  if (m?.kind !== "photo") return;
  await webpDerivative(env, m, originalAbs(env.ctx.db, m), "preview", PREVIEW_SIZE);
}

/** Frame representativo (tone mapping si es HDR) → `poster` y también `thumb`, para que la grilla no quede vacía. */
export async function videoPoster(env: JobEnv, mediaId: string): Promise<void> {
  const { db } = env.ctx;
  const m = loadMedia(db, mediaId);
  if (m?.kind !== "video") return;
  const fast = fastVolume(db);
  const frame = join(fast.path, "tmp", `frame-${ulid()}.png`);
  await mkdir(dirname(frame), { recursive: true });
  try {
    await extractFrame(
      originalAbs(db, m),
      frame,
      { hdr: m.hdr === 1, durationMs: m.duration_ms },
      { signal: env.signal },
    );
    await webpDerivative(env, m, frame, "poster", PREVIEW_SIZE);
    await webpDerivative(env, m, frame, "thumb", THUMB_SIZE);
  } finally {
    await rm(frame, { force: true });
  }
  db.transaction(() => {
    db.query("UPDATE media SET status = 'ready', error = NULL WHERE id = ?").run(m.id);
    enqueue(db, "video_transcode", m.id);
  })();
}

/** MP4 H.264/AAC, lado corto 1080, faststart, SIN metadata; en el disco grande donde está el original. */
export async function videoTranscode(env: JobEnv, mediaId: string): Promise<void> {
  const { db } = env.ctx;
  const m = loadMedia(db, mediaId);
  if (m?.kind !== "video") return;
  const rel = videoRelPath(new Date(m.taken_at ?? m.uploaded_at), m.sha256);
  const dest = join(getVolume(db, m.volume_id).path, rel);
  const out = await withTemp(dest, "mp4", async (tmp) => {
    // Sin timeout fijo: un video largo en CPU puede tardar mucho. El lease se renueva con heartbeat.
    await run(transcodeArgs(originalAbs(db, m), tmp, { hdr: m.hdr === 1, nvenc: env.nvenc }), {
      timeoutMs: 6 * 3600_000,
      signal: env.signal,
    });
    return probe(tmp);
  });
  saveDerivative(db, m.id, "video", m.volume_id, rel, "video/mp4", out, Bun.file(dest).size);
}

// ── Parecidos ──────────────────────────────────────────────────────

export async function phash(env: JobEnv, mediaId: string): Promise<void> {
  const { db } = env.ctx;
  const m = loadMedia(db, mediaId);
  if (m?.kind !== "photo") return;
  const d = db
    .query<{ path: string; volume_id: string }, [string]>(
      "SELECT path, volume_id FROM derivatives WHERE media_id = ? AND variant = 'thumb'",
    )
    .get(m.id);
  if (!d) throw new Error("falta la miniatura para calcular el hash");
  const h = await dhash(join(getVolume(db, d.volume_id).path, d.path), { signal: env.signal });
  db.transaction(() => {
    db.query("UPDATE media SET phash = ? WHERE id = ?").run(hashToHex(h), m.id);
    if (!nearlyConstant(h)) enqueue(db, "find_similar", m.id);
  })();
}

export const SIMILAR_MAX_DISTANCE = 6;
const SIMILAR_WINDOW_MS = 10 * 60_000;

/** Fotos con dHash a distancia ≤ 6 tomadas en ±10 min → `similar_pairs` (solo sugerencia). */
export function findSimilar(db: Database, mediaId: string): number {
  const m = db
    .query<{ phash: string | null; taken_at: string | null }, [string]>(
      "SELECT phash, taken_at FROM media WHERE id = ? AND deleted_at IS NULL AND kind = 'photo'",
    )
    .get(mediaId);
  if (!m?.phash || !m.taken_at) return 0;
  const t = new Date(m.taken_at).getTime();
  const h = BigInt(`0x${m.phash}`);
  const others = db
    .query<{ id: string; phash: string }, [string, string, string]>(
      `SELECT id, phash FROM media
       WHERE id != ? AND kind = 'photo' AND phash IS NOT NULL AND deleted_at IS NULL AND taken_at BETWEEN ? AND ?`,
    )
    .all(mediaId, new Date(t - SIMILAR_WINDOW_MS).toISOString(), new Date(t + SIMILAR_WINDOW_MS).toISOString());
  const insert = db.query(
    `INSERT INTO similar_pairs (id, media_a, media_b, distance, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)
     ON CONFLICT (media_a, media_b) DO NOTHING`,
  );
  let n = 0;
  const now = new Date().toISOString();
  for (const o of others) {
    const oh = BigInt(`0x${o.phash}`);
    const dist = hamming(h, oh);
    if (dist > SIMILAR_MAX_DISTANCE || nearlyConstant(oh)) continue;
    const [a, b] = mediaId < o.id ? [mediaId, o.id] : [o.id, mediaId];
    n += insert.run(ulid(), a, b, dist, now).changes;
  }
  return n;
}

// Almacenamiento en dos niveles: "fast" (base y derivados de fotos) y una lista de discos "bulk"
// (originales y videos). Lo nuevo va al bulk con más espacio libre.
import type { Database } from "bun:sqlite";
import { copyFile, mkdir, rename, rm, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ulid } from "ulid";
import type { Config } from "../config";

export type Volume = { id: string; tier: "fast" | "bulk"; path: string; enabled: number };
export type Usage = { totalBytes: number; freeBytes: number; usedBytes: number; usedPercent: number };

/** Sincroniza la tabla `volumes` con el .env. Los discos que salen del .env quedan deshabilitados, nunca borrados. */
export function syncVolumes(db: Database, config: Pick<Config, "fastPath" | "bulkPaths">): void {
  const now = new Date().toISOString();
  const upsert = db.query(
    `INSERT INTO volumes (id, tier, path, enabled, created_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (tier, path) DO UPDATE SET enabled = 1`,
  );
  db.transaction(() => {
    db.query("UPDATE volumes SET enabled = 0").run();
    upsert.run(ulid(), "fast", config.fastPath, now);
    for (const p of config.bulkPaths) upsert.run(ulid(), "bulk", p, now);
  })();
}

export function getVolume(db: Database, id: string): Volume {
  const v = db.query<Volume, [string]>("SELECT id, tier, path, enabled FROM volumes WHERE id = ?").get(id);
  if (!v) throw new Error(`volumen inexistente: ${id}`);
  return v;
}

export function listVolumes(db: Database): Volume[] {
  return db
    .query<Volume, []>("SELECT id, tier, path, enabled FROM volumes WHERE enabled = 1 ORDER BY tier, path")
    .all();
}

export function fastVolume(db: Database): Volume {
  const v = db
    .query<Volume, []>("SELECT id, tier, path, enabled FROM volumes WHERE tier = 'fast' AND enabled = 1")
    .get();
  if (!v) throw new Error("no hay volumen fast habilitado (¿se llamó a syncVolumes?)");
  return v;
}

export async function volumeUsage(path: string): Promise<Usage> {
  await mkdir(path, { recursive: true });
  const s = await statfs(path);
  const totalBytes = s.blocks * s.bsize;
  const freeBytes = s.bavail * s.bsize;
  const usedBytes = totalBytes - s.bfree * s.bsize;
  return { totalBytes, freeBytes, usedBytes, usedPercent: totalBytes ? (usedBytes / totalBytes) * 100 : 0 };
}

/** El disco bulk habilitado con más espacio libre. */
export async function pickBulkVolume(db: Database): Promise<Volume> {
  const vols = db
    .query<Volume, []>("SELECT id, tier, path, enabled FROM volumes WHERE tier = 'bulk' AND enabled = 1")
    .all();
  if (!vols.length) throw new Error("no hay discos bulk habilitados");
  const withFree = await Promise.all(vols.map(async (v) => ({ v, free: (await volumeUsage(v.path)).freeBytes })));
  return withFree.reduce((best, x) => (x.free > best.free ? x : best)).v;
}

export const absPath = (db: Database, volumeId: string, rel: string) => join(getVolume(db, volumeId).path, rel);

const pad = (n: number) => String(n).padStart(2, "0");
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 30) || "miembro";

/**
 * Ruta legible del original: `originales/AAAA/MM/AAAA-MM-DD_HHMMSS_<miembro>_<sha8>.<ext>`.
 * `date` es la hora local de la toma si se conoce (sin convertir a UTC); si no, la mejor aproximación.
 */
export function originalRelPath(date: Date, memberName: string, sha256: string, ext: string): string {
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const stamp = `${y}-${mo}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  const cleanExt =
    ext
      .replace(/^\./, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "bin";
  return join("originales", String(y), mo, `${stamp}_${slug(memberName)}_${sha256.slice(0, 8)}.${cleanExt}`);
}

/** Derivados de fotos y posters (en fast): `derivados/ab/cd/<sha256>_<variant>.webp`. */
export const derivativeRelPath = (sha256: string, variant: "thumb" | "preview" | "poster") =>
  join("derivados", sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}_${variant}.webp`);

/** Video convertido (en bulk): `videos/AAAA/MM/<sha256>_1080.mp4`. */
export const videoRelPath = (date: Date, sha256: string) =>
  join("videos", String(date.getUTCFullYear()), pad(date.getUTCMonth() + 1), `${sha256}_1080.mp4`);

/** Temporales de tus en el disco destino, para que el paso final sea un rename sin copia. */
export const tusTmpDir = (volume: Volume) => join(volume.path, "tmp", "tus");

/**
 * Mueve `src` a `dest` de forma atómica: rename si están en el mismo disco; si no, copia a un
 * temporal junto al destino y rename. Nunca deja un archivo a medio escribir en `dest`.
 */
export async function moveAtomic(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  try {
    await rename(src, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    const tmp = `${dest}.tmp-${ulid()}`;
    await copyFile(src, tmp);
    await rename(tmp, dest);
    await rm(src);
  }
}

/** Escribe bytes de forma atómica (temporal + rename). Para derivados. */
export async function writeAtomic(dest: string, data: Blob | Uint8Array | string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${ulid()}`;
  await Bun.write(tmp, data);
  await rename(tmp, dest);
}

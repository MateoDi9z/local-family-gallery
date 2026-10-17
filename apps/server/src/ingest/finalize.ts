// Finalización de una subida (tus o Atajo): SHA-256, deduplicación, mover al disco, registrar y encolar.
// Los bytes del original nunca se tocan: solo se mueven.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ulid } from "ulid";
import type { Ctx } from "../context";
import { enqueue } from "../jobs/enqueue";
import { absPath, moveAtomic, originalRelPath, pickBulkVolume } from "../storage";
import { extOf, hashFile, mediaTypeOf, partialHashFile } from "./common";

export type Incoming = {
  /** Archivo completo, idealmente en `tmp/` de un disco bulk (así el paso final es un rename). */
  tmpPath: string;
  batchId: string;
  name: string;
  /** `lastModified` del cliente, ms desde epoch. */
  lastModified?: number;
};
export type Finalized = { mediaId: string; duplicate: boolean };

// Serializa por hash: dos subidas del mismo archivo a la vez no pueden crear dos registros.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

export async function finalizeUpload(ctx: Ctx, f: Incoming): Promise<Finalized> {
  const { db, log } = ctx;
  const type = mediaTypeOf(f.name);
  if (!type) throw new Error("formato no soportado");
  const sha256 = await hashFile(f.tmpPath);
  const partial = await partialHashFile(f.tmpPath);
  const size = Bun.file(f.tmpPath).size;

  return withLock(sha256, async () => {
    const now = new Date().toISOString();
    const addItem = db.query(
      "INSERT OR IGNORE INTO batch_items (batch_id, media_id, duplicate, created_at) VALUES (?, ?, ?, ?)",
    );
    const existing = db
      .query<{ id: string; deleted_at: string | null; volume_id: string; original_path: string }, [string]>(
        "SELECT id, deleted_at, volume_id, original_path FROM media WHERE sha256 = ?",
      )
      .get(sha256);

    if (existing && !existing.deleted_at) {
      await rm(f.tmpPath, { force: true });
      addItem.run(f.batchId, existing.id, 1, now);
      return { mediaId: existing.id, duplicate: true };
    }

    if (existing) {
      // Estaba en la papelera y alguien lo vuelve a subir: se restaura (mismo registro, mismos bytes).
      const dest = absPath(db, existing.volume_id, existing.original_path);
      if (await Bun.file(dest).exists()) await rm(f.tmpPath, { force: true });
      else await moveAtomic(f.tmpPath, dest);
      db.transaction(() => {
        db.query("UPDATE media SET deleted_at = NULL WHERE id = ?").run(existing.id);
        addItem.run(f.batchId, existing.id, 0, now);
      })();
      log.info("original restaurado de la papelera", { mediaId: existing.id });
      return { mediaId: existing.id, duplicate: false };
    }

    const batch = db
      .query<{ member_id: string; name: string }, [string]>(
        "SELECT b.member_id, m.name FROM batches b JOIN members m ON m.id = b.member_id WHERE b.id = ?",
      )
      .get(f.batchId);
    if (!batch) throw new Error("lote inexistente");

    const modified = new Date(f.lastModified ?? Number.NaN);
    const hasModified = !Number.isNaN(modified.getTime());
    const vol = await pickBulkVolume(db);
    // Nombre provisorio con la fecha del cliente; el worker lo renombra con la fecha real.
    let rel = originalRelPath(hasModified ? modified : new Date(), batch.name, sha256, extOf(f.name));
    // Nunca pisar otro original (mismo segundo, miembro y sha8: casi imposible, pero sería perder una foto).
    if (await Bun.file(join(vol.path, rel)).exists()) rel = rel.replace(/(\.[a-z0-9]+)$/, `_${ulid()}$1`);
    await moveAtomic(f.tmpPath, join(vol.path, rel));

    const id = ulid();
    try {
      db.transaction(() => {
        db.query(
          `INSERT INTO media (id, sha256, partial_hash, kind, mime, size_bytes, original_name, volume_id, original_path,
             member_id, batch_id, uploaded_at, file_modified_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing')`,
        ).run(
          id,
          sha256,
          partial,
          type.kind,
          type.mime,
          size,
          f.name,
          vol.id,
          rel,
          batch.member_id,
          f.batchId,
          now,
          hasModified ? modified.toISOString() : null,
        );
        addItem.run(f.batchId, id, 0, now);
        enqueue(db, "extract_metadata", id);
      })();
    } catch (e) {
      // El original ya está a salvo en el disco: no se borra. Queda en el log para recuperarlo a mano.
      log.error("original guardado pero sin registrar", { volumeId: vol.id, rel, err: String(e) });
      throw e;
    }
    return { mediaId: id, duplicate: false };
  });
}

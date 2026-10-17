// `bun apps/server/src/main.ts move-volume --from <ruta> --to <ruta>`: mueve originales y videos
// convertidos de un disco bulk a otro. Uno por uno, reanudable, verificando antes de borrar el origen.
import type { Database } from "bun:sqlite";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ulid } from "ulid";
import type { Ctx } from "../context";
import type { Volume } from "../storage";
import { hashFile } from "./common";

export type MoveSummary = { moved: number; failed: number; bytes: number };

type Item = {
  kind: "original" | "video";
  mediaId: string;
  rel: string;
  /** Verificación del destino: SHA-256 conocido (originales) o tamaño (videos convertidos). */
  sha256: string | null;
  bytes: number;
};

function bulkVolumeByPath(db: Database, path: string): Volume | null {
  return db
    .query<Volume, [string]>("SELECT id, tier, path, enabled FROM volumes WHERE tier = 'bulk' AND path = ?")
    .get(resolve(path));
}

async function verify(path: string, item: Item): Promise<boolean> {
  const f = Bun.file(path);
  if (!(await f.exists()) || f.size !== item.bytes) return false;
  return item.sha256 ? (await hashFile(path)) === item.sha256 : true;
}

export async function moveVolume(ctx: Ctx, fromPath: string, toPath: string): Promise<MoveSummary> {
  const { db, log } = ctx;
  const from = bulkVolumeByPath(db, fromPath);
  const to = bulkVolumeByPath(db, toPath);
  if (!from) throw new Error(`El origen no es un disco bulk conocido: ${fromPath}`);
  if (!to?.enabled) throw new Error(`El destino tiene que estar en DATA_BULK_PATHS: ${toPath}`);
  if (from.id === to.id) throw new Error("El origen y el destino son el mismo disco.");

  const items: Item[] = [
    ...db
      .query<Item, [string]>(
        `SELECT 'original' AS kind, id AS mediaId, original_path AS rel, sha256, size_bytes AS bytes
         FROM media WHERE volume_id = ?`,
      )
      .all(from.id),
    ...db
      .query<Item, [string]>(
        `SELECT 'video' AS kind, media_id AS mediaId, path AS rel, NULL AS sha256, bytes
         FROM derivatives WHERE variant = 'video' AND volume_id = ?`,
      )
      .all(from.id),
  ];
  const sum: MoveSummary = { moved: 0, failed: 0, bytes: 0 };
  for (const item of items) {
    const src = join(from.path, item.rel);
    const dest = join(to.path, item.rel);
    try {
      await mkdir(dirname(dest), { recursive: true });
      // Reanudación: si ya está en el destino y verifica, solo falta actualizar la base.
      if (!(await verify(dest, item))) {
        try {
          await rename(src, dest); // mismo filesystem: atómico, sin copiar
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
          const tmp = `${dest}.tmp-${ulid()}`;
          await copyFile(src, tmp);
          if (!(await verify(tmp, item))) {
            await rm(tmp, { force: true });
            throw new Error("la copia no coincide con el original");
          }
          await rename(tmp, dest);
        }
      }
      if (item.kind === "original")
        db.query("UPDATE media SET volume_id = ? WHERE id = ? AND volume_id = ?").run(to.id, item.mediaId, from.id);
      else
        db.query("UPDATE derivatives SET volume_id = ? WHERE media_id = ? AND variant = 'video' AND volume_id = ?").run(
          to.id,
          item.mediaId,
          from.id,
        );
      // Recién con la base apuntando al destino se borra el origen.
      await rm(src, { force: true });
      sum.moved++;
      sum.bytes += item.bytes;
    } catch (e) {
      sum.failed++;
      log.error("no se pudo mover un archivo", { mediaId: item.mediaId, kind: item.kind, err: String(e) });
    }
  }
  return sum;
}

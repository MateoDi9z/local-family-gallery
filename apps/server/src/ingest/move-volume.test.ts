import { expect, test } from "bun:test";
import { join } from "node:path";
import { syncVolumes, videoRelPath } from "../storage";
import { FIXTURES } from "../test-utils";
import { hashFile } from "./common";
import { finalizeUpload } from "./finalize";
import { moveVolume } from "./move-volume";
import { makeEnv, newBatch, setupGallery } from "./testkit";

test("move-volume mueve originales y videos convertidos, actualiza la base y es reanudable", async () => {
  const { app, ctx, db, dir, bulk } = await makeEnv(1);
  const { c } = await setupGallery(app);
  const batchId = await newBatch(c);
  const ids: string[] = [];
  for (const name of ["foto-gps.jpg", "video-sdr.mp4"]) {
    const tmpPath = join(dir, `${name}.tmp`);
    await Bun.write(tmpPath, Bun.file(join(FIXTURES, name)));
    ids.push((await finalizeUpload(ctx, { tmpPath, batchId, name })).mediaId);
  }
  const [b1, b2] = [bulk[0] as string, join(dir, "b2")];
  const vol = (p: string) => db.query<{ id: string }, [string]>("SELECT id FROM volumes WHERE path = ?").get(p)?.id;
  // Video convertido a mano en b1 (lo produce el worker).
  const vrel = videoRelPath(new Date("2024-03-05T00:00:00Z"), "a".repeat(64));
  await Bun.write(join(b1, vrel), "video-convertido");
  db.query(
    "INSERT INTO derivatives (media_id, variant, volume_id, path, mime, bytes) VALUES (?, 'video', ?, ?, 'video/mp4', 16)",
  ).run(ids[1] as string, vol(b1) as string, vrel);

  // El destino tiene que estar en la configuración.
  await expect(moveVolume(ctx, b1, b2)).rejects.toThrow("DATA_BULK_PATHS");
  syncVolumes(db, { fastPath: ctx.config.fastPath, bulkPaths: [b1, b2] });

  // Simula un corte: el primer original ya se había copiado al destino, pero la base no se actualizó.
  const first = db
    .query<{ original_path: string }, [string]>("SELECT original_path FROM media WHERE id = ?")
    .get(ids[0] as string);
  await Bun.write(join(b2, first?.original_path ?? ""), Bun.file(join(b1, first?.original_path ?? "")));

  const sum = await moveVolume(ctx, b1, b2);
  expect(sum).toEqual({ moved: 3, failed: 0, bytes: expect.any(Number) });
  const rows = db
    .query<{ sha256: string; original_path: string; volume_id: string }, []>(
      "SELECT sha256, original_path, volume_id FROM media",
    )
    .all();
  for (const r of rows) {
    expect(r.volume_id).toBe(vol(b2) as string);
    expect(await hashFile(join(b2, r.original_path))).toBe(r.sha256);
    expect(await Bun.file(join(b1, r.original_path)).exists()).toBe(false);
  }
  expect(db.query("SELECT volume_id FROM derivatives WHERE variant = 'video'").get()).toEqual({ volume_id: vol(b2) });
  expect(await Bun.file(join(b2, vrel)).text()).toBe("video-convertido");

  // Correrlo de nuevo no hace nada.
  expect(await moveVolume(ctx, b1, b2)).toEqual({ moved: 0, failed: 0, bytes: 0 });
});

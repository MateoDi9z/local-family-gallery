import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDb } from "../db";
import { fastVolume, listVolumes, moveAtomic, originalRelPath, pickBulkVolume, syncVolumes } from ".";

test("ruta legible del original", () => {
  const p = originalRelPath(
    new Date("2024-03-05T14:07:09Z"),
    "Persona Ñandú 1",
    "abcdef0123456789".padEnd(64, "0"),
    ".HEIC",
  );
  expect(p).toBe("originales/2024/03/2024-03-05_140709_persona-nandu-1_abcdef01.heic");
});

test("syncVolumes: deshabilita, no borra, y elige un bulk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lfg-"));
  const db = openDb(":memory:");
  migrate(db);
  syncVolumes(db, { fastPath: join(dir, "fast"), bulkPaths: [join(dir, "b1"), join(dir, "b2")] });
  expect(listVolumes(db)).toHaveLength(3);
  expect(fastVolume(db).path).toBe(join(dir, "fast"));
  syncVolumes(db, { fastPath: join(dir, "fast"), bulkPaths: [join(dir, "b2")] });
  expect(
    listVolumes(db)
      .filter((v) => v.tier === "bulk")
      .map((v) => v.path),
  ).toEqual([join(dir, "b2")]);
  expect(db.query("SELECT count(*) AS n FROM volumes").get()).toEqual({ n: 3 });
  expect((await pickBulkVolume(db)).path).toBe(join(dir, "b2"));
});

test("moveAtomic mueve y crea carpetas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lfg-"));
  await Bun.write(join(dir, "a.bin"), "bytes");
  await moveAtomic(join(dir, "a.bin"), join(dir, "x/y/b.bin"));
  expect(await readFile(join(dir, "x/y/b.bin"), "utf8")).toBe("bytes");
  expect(await Bun.file(join(dir, "a.bin")).exists()).toBe(false);
});

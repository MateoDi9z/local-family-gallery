import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { partialHash } from "@lfg/shared";
import { mediaTypeOf, partialHashFile } from "./common";

test("partialHashFile da lo mismo que el partialHash compartido (chico y > 2 MiB)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lfg-ph-"));
  for (const size of [0, 1000, 2 * 1024 * 1024, 3 * 1024 * 1024 + 7]) {
    const bytes = crypto.getRandomValues(new Uint8Array(size > 65536 ? 65536 : size));
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i += bytes.length) data.set(bytes.subarray(0, Math.min(bytes.length, size - i)), i);
    data[size - 1] = 42;
    const p = join(dir, `f${size}`);
    await Bun.write(p, data);
    expect(await partialHashFile(p)).toBe(await partialHash(new Blob([data])));
  }
});

test("formatos por extensión, sin importar mayúsculas", () => {
  expect(mediaTypeOf("IMG_0001.HEIC")).toEqual({ kind: "photo", mime: "image/heic" });
  expect(mediaTypeOf("video.3gp")?.kind).toBe("video");
  expect(mediaTypeOf("notas.txt")).toBeNull();
  expect(mediaTypeOf("constructor")).toBeNull();
  expect(mediaTypeOf("x.constructor")).toBeNull();
});

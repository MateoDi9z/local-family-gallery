import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { partialHash } from "@lfg/shared";
import { FIXTURES } from "../test-utils";
import { mediaExtOf, mediaTypeOf, nameWithExt, partialHashFile, sniffExt } from "./common";

test("el formato sale de los primeros bytes; el nombre es el respaldo", async () => {
  const head = async (f: string) => new Uint8Array(await Bun.file(join(FIXTURES, f)).slice(0, 16).arrayBuffer());
  expect(sniffExt(await head("foto-gps.jpg"))).toBe("jpg");
  expect(sniffExt(await head("captura.png"))).toBe("png");
  expect(sniffExt(await head("foto-rotada.heic"))).toBe("heic");
  expect(sniffExt(await head("video-hdr.mov"))).toBe("mov");
  expect(sniffExt(await head("video-sdr.mp4"))).toBe("mp4");
  expect(sniffExt(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
  expect(sniffExt(await head("manifest.json"))).toBeNull();
  expect(sniffExt(new Uint8Array())).toBeNull();
  // Sin nombre, o con la extensión de antes de que iOS lo convirtiera: manda el contenido.
  expect(mediaExtOf(await head("foto-gps.jpg"), "")).toBe("jpg");
  expect(mediaExtOf(await head("foto-gps.jpg"), "IMG_0001.HEIC")).toBe("jpg");
  expect(mediaExtOf(new Uint8Array(16), "raro.mp4")).toBe("mp4");
  expect(mediaExtOf(await head("manifest.json"), "manifest.json")).toBeNull();
});

test("el nombre queda con la extensión del contenido", () => {
  expect(nameWithExt("IMG_0001.JPG", "jpg")).toBe("IMG_0001.JPG");
  expect(nameWithExt("foto.jpeg", "jpg")).toBe("foto.jpeg");
  expect(nameWithExt("file", "heic")).toBe("file.heic");
  expect(nameWithExt("", "mov")).toBe("archivo.mov");
  expect(nameWithExt("IMG_0002.HEIC", "jpg")).toBe("IMG_0002.jpg");
});

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

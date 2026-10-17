// Pipeline real contra los fixtures sintéticos. Solo corre con `bun run test:media` (vips, exiftool, ffmpeg).
import { afterEach, expect } from "bun:test";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES, mediaTest } from "../test-utils";
import { addMedia, addMember, type TestEnv, testEnv } from "../worker/testing";
import { run } from "./exec";
import { ExifTool } from "./exiftool";
import { hamming } from "./images";
import { extractMetadata, findSimilar, type JobEnv, phash, thumb, videoPoster, videoTranscode } from "./pipeline";
import { probe } from "./video";

let env: TestEnv;
let exif: ExifTool;
afterEach(async () => {
  await exif?.close();
  await env?.cleanup();
});

async function job(): Promise<JobEnv> {
  env = await testEnv();
  exif = new ExifTool();
  return { ctx: env.ctx, exif, nvenc: false };
}

/** Copia un fixture al disco grande y crea el registro. Devuelve el id. */
async function place(memberId: string, file: string, fields: Record<string, string | number | null>) {
  const rel = join("originales", file);
  const abs = join(env.bulk, rel);
  await mkdir(join(env.bulk, "originales"), { recursive: true });
  await copyFile(join(FIXTURES, file), abs);
  const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer());
  return addMedia(env.db, memberId, {
    original_name: file,
    original_path: rel,
    size_bytes: bytes.byteLength,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    ...fields,
  });
}

const rowOf = (id: string) =>
  env.db
    .query<
      { lat: number | null; lon: number | null; orientation: number | null; hdr: number; original_path: string },
      [string]
    >("SELECT lat, lon, orientation, hdr, original_path FROM media WHERE id = ?")
    .get(id);

async function sameBytes(id: string, file: string) {
  const row = rowOf(id);
  const now = new Uint8Array(await Bun.file(join(env.bulk, row?.original_path ?? "")).arrayBuffer());
  const orig = new Uint8Array(await Bun.file(join(FIXTURES, file)).arrayBuffer());
  expect(now).toEqual(orig);
}

async function pixel(path: string, x: number, y: number): Promise<number[]> {
  const out = await run(["vips", "getpoint", path, String(Math.round(x)), String(Math.round(y))]);
  return (out.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).slice(-3);
}

/** Nombres de los átomos de primer nivel. Con faststart, `moov` aparece antes que `mdat`. */
function topLevelBoxes(file: Uint8Array): string[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const names: string[] = [];
  let o = 0;
  while (o + 8 <= file.byteLength && names.length < 8) {
    let size = view.getUint32(o);
    const name = String.fromCharCode(file[o + 4] ?? 0, file[o + 5] ?? 0, file[o + 6] ?? 0, file[o + 7] ?? 0);
    names.push(name);
    if (size === 1 && o + 16 <= file.byteLength) size = view.getUint32(o + 8) * 2 ** 32 + view.getUint32(o + 12);
    if (size < 8) break;
    o += size;
  }
  return names;
}

mediaTest("HEIC rotado: GPS, miniatura de pie sin metadata y original intacto", async () => {
  const j = await job();
  const member = addMember(env.db);
  const id = await place(member, "foto-rotada.heic", { kind: "photo", mime: "image/heic" });
  await extractMetadata(j, id);
  const meta = rowOf(id);
  expect(meta?.lat).toBeCloseTo(48.8584, 3);
  expect(meta?.lon).toBeCloseTo(2.2945, 3);
  expect(meta?.orientation).toBe(6);
  await sameBytes(id, "foto-rotada.heic");

  await thumb(j, id);
  const thumbRow = env.db
    .query<{ path: string }, [string]>("SELECT path FROM derivatives WHERE media_id = ? AND variant = 'thumb'")
    .get(id);
  const thumbPath = join(env.fast, thumbRow?.path ?? "");
  const header = await run(["vipsheader", thumbPath]);
  const dims = /:\s*(\d+)x(\d+)/.exec(header);
  const width = Number(dims?.[1]);
  const height = Number(dims?.[2]);
  // irot deja la foto de pie (1200×1600 → ancho 400). La franja roja queda arriba a la derecha.
  expect(width).toBe(400);
  expect(height).toBeGreaterThan(width);
  const red = await pixel(thumbPath, width - 15, 20);
  const left = await pixel(thumbPath, 20, 20);
  expect(red[0] ?? 0).toBeGreaterThan(180);
  expect(red[1] ?? 255).toBeLessThan(80);
  expect(left[0] ?? 255).toBeLessThan(80);

  const gps = JSON.parse(await run(["exiftool", "-n", "-j", "-GPSLatitude", "-GPSLongitude", thumbPath])) as Record<
    string,
    unknown
  >[];
  expect(gps[0]?.GPSLatitude).toBeUndefined();
});

mediaTest("MOV HDR: GPS de QuickTime, MP4 SDR bt709 con faststart y sin metadata", async () => {
  const j = await job();
  const member = addMember(env.db);
  const id = await place(member, "video-hdr.mov", { kind: "video", mime: "video/quicktime" });
  await extractMetadata(j, id);
  const meta = rowOf(id);
  expect(meta?.lat).toBeCloseTo(-33.8568, 3);
  expect(meta?.lon).toBeCloseTo(151.2153, 3);
  expect(meta?.hdr).toBe(1);
  await sameBytes(id, "video-hdr.mov");

  await videoPoster(j, id);
  await videoTranscode(j, id);
  const video = env.db
    .query<{ path: string }, [string]>("SELECT path FROM derivatives WHERE media_id = ? AND variant = 'video'")
    .get(id);
  const out = join(env.bulk, video?.path ?? "");
  const probed = await probe(out);
  expect(probed.hdr).toBe(false);
  const raw = JSON.parse(
    await run([
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,color_transfer",
      "-of",
      "json",
      out,
    ]),
  ) as { streams?: { codec_name?: string; color_transfer?: string }[] };
  expect(raw.streams?.[0]?.codec_name).toBe("h264");
  expect(raw.streams?.[0]?.color_transfer).toBe("bt709");

  const boxes = topLevelBoxes(new Uint8Array(await Bun.file(out).arrayBuffer()));
  expect(boxes.indexOf("moov")).toBeGreaterThanOrEqual(0);
  expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));

  const gps = JSON.parse(await run(["exiftool", "-n", "-j", "-GPSLatitude", "-GPSCoordinates", out])) as Record<
    string,
    unknown
  >[];
  expect(gps[0]?.GPSLatitude ?? gps[0]?.GPSCoordinates).toBeUndefined();
});

mediaTest("dos fotos parecidas: dHash a distancia ≤ 6 y una sugerencia, sin borrar nada", async () => {
  const j = await job();
  const member = addMember(env.db);
  const taken = "2023-07-14T08:00:00.000Z";
  const a = await place(member, "foto-gps.jpg", { kind: "photo", mime: "image/jpeg", taken_at: taken });
  const b = await place(member, "foto-parecida.jpg", {
    kind: "photo",
    mime: "image/jpeg",
    taken_at: "2023-07-14T08:00:05.000Z",
  });
  await thumb(j, a);
  await thumb(j, b);
  await phash(j, a);
  await phash(j, b);
  const hashes = env.db
    .query<{ id: string; phash: string }, [string, string]>("SELECT id, phash FROM media WHERE id IN (?, ?)")
    .all(a, b);
  const ha = hashes.find((h) => h.id === a)?.phash;
  const hb = hashes.find((h) => h.id === b)?.phash;
  expect(ha).toBeTruthy();
  expect(hb).toBeTruthy();
  expect(hamming(BigInt(`0x${ha}`), BigInt(`0x${hb}`))).toBeLessThanOrEqual(6);
  expect(findSimilar(env.db, a)).toBe(1);
  const pair = env.db
    .query<{ distance: number; status: string }, []>("SELECT distance, status FROM similar_pairs")
    .get();
  expect(pair?.status).toBe("pending");
  expect(pair?.distance).toBeLessThanOrEqual(6);
  expect(env.db.query<{ n: number }, []>("SELECT count(*) AS n FROM media").get()?.n).toBe(2);
});

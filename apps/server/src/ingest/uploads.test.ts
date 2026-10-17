import { afterEach, expect, spyOn, test } from "bun:test";
import * as fsp from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type BatchSummary, partialHash } from "@lfg/shared";
import { FIXTURES } from "../test-utils";
import { hashFile } from "./common";
import { finalizeUpload } from "./finalize";
import { client, makeEnv, newBatch, serve, setupGallery, tusUpload } from "./testkit";
import { sweepTus, TUS_EXPIRATION_MS } from "./tus";

const servers: { stop: (force?: boolean) => void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

async function env(bulkCount = 1) {
  const e = await makeEnv(bulkCount);
  const { c, members } = await setupGallery(e.app);
  const server = serve(e.app);
  servers.push(server);
  return { ...e, c, members, tusUrl: `${server.url}api/tus` };
}

const fixture = async (name: string) => Buffer.from(await Bun.file(join(FIXTURES, name)).arrayBuffer());
const meta = (batchId: string, filename: string) => ({
  filename,
  filetype: "",
  batchId,
  lastModified: String(Date.parse("2024-03-05T14:07:09Z")),
});

test("dedup: el mismo archivo dos veces es un solo registro y el segundo cuenta como duplicado", async () => {
  const { c, db, tusUrl } = await env();
  const data = await fixture("foto-gps.jpg");
  const pre = { files: [{ size: data.length, partialHash: await partialHash(new Blob([data])) }] };
  expect(await (await c.req("/api/uploads/precheck", { json: pre })).json()).toEqual([{ exists: false }]);

  const b1 = await newBatch(c);
  await tusUpload(tusUrl, data, { cookie: c.cookie, meta: meta(b1, "IMG_0001.JPG") }).done;
  const b2 = await newBatch(c);
  await tusUpload(tusUrl, data, { cookie: c.cookie, meta: meta(b2, "copia.jpg") }).done;

  const media = db.query<{ id: string; original_path: string }, []>("SELECT id, original_path FROM media").all();
  expect(media).toHaveLength(1);
  expect(media[0]?.original_path).toMatch(/^originales\/2024\/03\/2024-03-05_140709_persona-1_3c15adb8\.jpg$/);
  const items = db.query("SELECT batch_id, duplicate FROM batch_items ORDER BY batch_id").all();
  expect(items).toEqual([
    { batch_id: b1, duplicate: 0 },
    { batch_id: b2, duplicate: 1 },
  ]);
  expect(db.query("SELECT count(*) AS n FROM jobs WHERE type = 'extract_metadata'").get()).toEqual({ n: 1 });

  // Precheck: mismo orden y largo que el request.
  const other = { size: 5, partialHash: "0".repeat(64) };
  const res = await c.req("/api/uploads/precheck", { json: { files: [other, pre.files[0], other] } });
  expect(await res.json()).toEqual([{ exists: false }, { exists: true, mediaId: media[0]?.id }, { exists: false }]);

  const sum = (await (await c.req(`/api/batches/${b2}/summary`)).json()) as BatchSummary;
  expect(sum).toMatchObject({ total: 1, newCount: 0, duplicateCount: 1, processingCount: 1 });
});

test("volver a subir algo que estaba en la papelera lo restaura (mismo registro)", async () => {
  const { c, ctx, db, dir } = await env();
  const up = async (batchId: string) => {
    const tmpPath = join(dir, "x.tmp");
    await Bun.write(tmpPath, await fixture("foto-gps.jpg"));
    return finalizeUpload(ctx, { tmpPath, batchId, name: "x.jpg" });
  };
  const first = await up(await newBatch(c));
  db.query("UPDATE media SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), first.mediaId);
  const again = await up(await newBatch(c));
  expect(again).toEqual({ mediaId: first.mediaId, duplicate: false });
  expect(db.query("SELECT count(*) AS n, max(deleted_at) AS d FROM media").get()).toEqual({ n: 1, d: null });
});

test("subida cortada a la mitad y reanudada: el original queda byte a byte", async () => {
  const { c, db, tusUrl } = await env();
  const data = await fixture("foto-gps.jpg");
  const batchId = await newBatch(c);
  const first = tusUpload(tusUrl, data, {
    cookie: c.cookie,
    meta: meta(batchId, "grande.jpg"),
    chunkSize: 16 * 1024,
    onProgress: (sent, total, up) => {
      if (sent >= total / 2) up.abort();
    },
  });
  // abort() no resuelve ni rechaza: esperamos a que el servidor tenga la mitad.
  let url = "";
  for (let i = 0; i < 100 && !url; i++) {
    await Bun.sleep(20);
    url = first.upload.url ?? "";
  }
  await Bun.sleep(100);
  const head = await fetch(url, { method: "HEAD", headers: { cookie: c.cookie, "Tus-Resumable": "1.0.0" } });
  const offset = Number(head.headers.get("upload-offset"));
  expect(offset).toBeGreaterThan(0);
  expect(offset).toBeLessThan(data.length);
  expect(db.query("SELECT count(*) AS n FROM media").get()).toEqual({ n: 0 });

  let resumedFrom = -1;
  await tusUpload(tusUrl, data, {
    cookie: c.cookie,
    meta: meta(batchId, "grande.jpg"),
    uploadUrl: url,
    chunkSize: 16 * 1024,
    onProgress: (sent) => {
      if (resumedFrom < 0) resumedFrom = sent;
    },
  }).done;
  expect(resumedFrom).toBeGreaterThanOrEqual(offset);

  const m = db
    .query<{ sha256: string; volume_id: string; original_path: string }, []>(
      "SELECT sha256, volume_id, original_path FROM media",
    )
    .get();
  const vol = db.query<{ path: string }, [string]>("SELECT path FROM volumes WHERE id = ?").get(m?.volume_id ?? "");
  const stored = join(vol?.path ?? "", m?.original_path ?? "");
  expect(await hashFile(stored)).toBe(new Bun.CryptoHasher("sha256").update(data).digest("hex"));
  expect(m?.sha256).toBe(await hashFile(stored));
});

test("tus rechaza formatos no soportados, lotes ajenos y subir sin miembro", async () => {
  const { app, c, db, members, tusUrl } = await env();
  const batchId = await newBatch(c);
  const data = Buffer.from("hola");
  const bad = await tusUpload(tusUrl, data, { cookie: c.cookie, meta: meta(batchId, "notas.txt") }).done.catch(
    (e: Error) => e,
  );
  expect(String(bad)).toContain("415");

  // Lote de otro miembro.
  db.query("UPDATE batches SET member_id = ? WHERE id = ?").run(members[1]?.id ?? "", batchId);
  const foreign = await tusUpload(tusUrl, data, { cookie: c.cookie, meta: meta(batchId, "a.jpg") }).done.catch(
    (e: Error) => e,
  );
  expect(String(foreign)).toContain("403");

  // Dispositivo sin miembro elegido: ni lote ni subida.
  const other = client(app);
  await other.req("/api/auth/pin", { json: { pin: "1234" } });
  const nb = await other.req("/api/batches", { json: { source: "web" } });
  expect(nb.status).toBe(409);
  expect((await nb.json()).error).toBe("member_required");
  const nm = await tusUpload(tusUrl, data, { cookie: other.cookie, meta: meta(batchId, "a.jpg") }).done.catch(
    (e: Error) => e,
  );
  expect(String(nm)).toContain("409");
  // Sin cookie: 401 antes de llegar a tus.
  const anon = await tusUpload(tusUrl, data, { cookie: "", meta: meta(batchId, "a.jpg") }).done.catch((e: Error) => e);
  expect(String(anon)).toContain("401");
});

test("elección de disco: el original va al bulk con más espacio libre", async () => {
  const { c, ctx, db, bulk, dir } = await env(2);
  const batchId = await newBatch(c);
  const spy = spyOn(fsp, "statfs").mockImplementation((async (p: string) => ({
    blocks: 1000,
    bsize: 1,
    bfree: 100,
    bavail: p.endsWith("b2") ? 900 : 100,
  })) as never);
  try {
    const tmpPath = join(dir, "subida.tmp");
    await Bun.write(tmpPath, await fixture("foto-sin-gps.jpg"));
    const r = await finalizeUpload(ctx, { tmpPath, batchId, name: "foto.jpg" });
    const row = db
      .query<{ path: string }, [string]>(
        "SELECT v.path FROM media m JOIN volumes v ON v.id = m.volume_id WHERE m.id = ?",
      )
      .get(r.mediaId);
    expect(row?.path).toBe(bulk[1] as string);
    expect(await Bun.file(tmpPath).exists()).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

test("resumen del lote: lugares, sin ubicación y sugerencia cargada a mano", async () => {
  const { c, ctx, db, dir, members } = await env();
  const batchId = await newBatch(c);
  const ids: string[] = [];
  for (const name of ["foto-gps.jpg", "foto-sin-gps.jpg", "foto-parecida.jpg", "captura.png"]) {
    const tmpPath = join(dir, `${name}.tmp`);
    await Bun.write(tmpPath, await fixture(name));
    ids.push((await finalizeUpload(ctx, { tmpPath, batchId, name })).mediaId);
  }
  const [gps, noGps, suggested, processing] = ids as [string, string, string, string];
  db.query(
    "INSERT INTO places (id, geoname_id, name, admin1, country_code, lat, lon) VALUES ('p1', 1, 'Ciudad de ejemplo', NULL, 'XX', 1, 2)",
  ).run();
  db.query(
    "UPDATE media SET status = 'ready', lat = 1, lon = 2, location_source = 'gps', location_confirmed = 1, place_id = 'p1' WHERE id = ?",
  ).run(gps);
  db.query("UPDATE media SET status = 'ready' WHERE id = ?").run(noGps);
  db.query(
    `UPDATE media SET status = 'ready', lat = 1.1, lon = 2.1, location_source = 'suggested', location_confirmed = 0,
     suggested_from_media_id = ?, suggestion_confidence = 0.8, place_id = 'p1' WHERE id = ?`,
  ).run(gps, suggested);

  const sum = (await (await c.req(`/api/batches/${batchId}/summary`)).json()) as BatchSummary;
  expect(sum).toMatchObject({ batchId, total: 4, newCount: 4, duplicateCount: 0, processingCount: 1 });
  expect(sum.places).toEqual([{ placeId: "p1", name: "Ciudad de ejemplo", count: 2 }]);
  const byId = new Map(sum.noLocation.map((x) => [x.media.id, x]));
  expect([...byId.keys()].sort()).toEqual([noGps, suggested].sort());
  expect(byId.has(processing)).toBe(false);
  expect(byId.get(noGps)?.suggestion).toBeNull();
  expect(byId.get(suggested)?.suggestion).toEqual({
    lat: 1.1,
    lon: 2.1,
    placeName: "Ciudad de ejemplo",
    fromMediaId: gps,
    confidence: 0.8,
  });
  expect(byId.get(noGps)?.media).toMatchObject({ memberId: members[0]?.id, originalName: "foto-sin-gps.jpg" });
  expect((await c.req("/api/batches/nada/summary")).status).toBe(404);
});

test("limpieza de tus: vence las incompletas y reintenta las completas sin finalizar", async () => {
  const { c, ctx, db, bulk } = await env();
  const batchId = await newBatch(c);
  const dir = join(bulk[0] as string, "tmp", "tus");
  await fsp.mkdir(dir, { recursive: true });
  const old = new Date(Date.now() - TUS_EXPIRATION_MS - 60_000).toISOString();
  await Bun.write(join(dir, "incompleta"), "abc");
  await Bun.write(join(dir, "incompleta.json"), JSON.stringify({ size: 10, creation_date: old }));
  const data = await fixture("foto-gps.jpg");
  await Bun.write(join(dir, "completa"), data);
  await Bun.write(
    join(dir, "completa.json"),
    JSON.stringify({ size: data.length, creation_date: old, metadata: meta(batchId, "x.jpg") }),
  );
  await sweepTus(ctx, Date.now() + 3600_000);
  expect(await readdir(dir)).toEqual([]);
  expect(db.query("SELECT original_name FROM media").all()).toEqual([{ original_name: "x.jpg" }]);
});

test("e2e por API: todos los fixtures por tus quedan encolados y byte a byte idénticos", async () => {
  const { c, db, tusUrl } = await env();
  const manifest = (await Bun.file(join(FIXTURES, "manifest.json")).json()) as Record<string, string>;
  const batchId = await newBatch(c, "desktop");
  for (const path of Object.keys(manifest)) {
    const name = path.replace(/^fixtures\//, "");
    await tusUpload(tusUrl, await fixture(name), { cookie: c.cookie, meta: meta(batchId, name) }).done;
  }
  const rows = db
    .query<{ id: string; sha256: string; original_name: string; vpath: string; original_path: string }, []>(
      "SELECT m.id, m.sha256, m.original_name, v.path AS vpath, m.original_path FROM media m JOIN volumes v ON v.id = m.volume_id",
    )
    .all();
  expect(rows).toHaveLength(Object.keys(manifest).length);
  for (const r of rows) {
    expect(r.sha256).toBe(manifest[`fixtures/${r.original_name}`] as string);
    expect(await hashFile(join(r.vpath, r.original_path))).toBe(r.sha256);
  }
  const jobs = db.query<{ media_id: string }, []>("SELECT media_id FROM jobs WHERE type = 'extract_metadata'").all();
  expect(jobs.map((j) => j.media_id).sort()).toEqual(rows.map((r) => r.id).sort());
  const kinds = db.query("SELECT kind, count(*) AS n FROM media GROUP BY kind ORDER BY kind").all();
  expect(kinds).toEqual([
    { kind: "photo", n: 5 },
    { kind: "video", n: 2 },
  ]);
  const sum = (await (await c.req(`/api/batches/${batchId}/summary`)).json()) as BatchSummary;
  expect(sum).toMatchObject({ total: 7, newCount: 7, duplicateCount: 0, processingCount: 7 });
});

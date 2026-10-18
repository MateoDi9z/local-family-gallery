import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { API_PREFIX, HomeResponse, MediaItem, MediaPage, PlaceDetail } from "@lfg/shared";
import { Hono } from "hono";
import { ZodError } from "zod";
import type { AppEnv } from "../context";
import { setSetting } from "../db";
import { assignTrips } from "../geo/trips";
import { derivativeRelPath } from "../storage";
import { addMedia, addMember, jobsOf, type TestEnv, testEnv } from "../worker/testing";
import { type ViewOptions, viewRoutes } from ".";

let env: TestEnv;
afterEach(() => env?.cleanup());

/** Las rutas montadas como en app.ts; el miembro sale del header `x-member` (en la app lo pone ingesta). */
function app(opts?: ViewOptions) {
  const api = new Hono<AppEnv>();
  api.use(async (c, next) => {
    c.set("ctx", env.ctx);
    c.set("deviceId", null);
    c.set("memberId", c.req.header("x-member") ?? null);
    await next();
  });
  api.route("/", viewRoutes(env.ctx, opts));
  const root = new Hono<AppEnv>();
  root.onError((err, c) =>
    err instanceof ZodError ? c.json({ error: "invalid" }, 400) : c.json({ error: String(err) }, 500),
  );
  root.route(API_PREFIX, api);
  return (path: string, init?: RequestInit & { member?: string }) =>
    root.request(`${API_PREFIX}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.member ? { "x-member": init.member } : {}) },
    });
}

const thumbFor = (mediaId: string) => {
  const sha = env.db.query<{ sha256: string }, [string]>("SELECT sha256 FROM media WHERE id = ?").get(mediaId)
    ?.sha256 as string;
  const fast = env.db.query<{ id: string }, []>("SELECT id FROM volumes WHERE tier = 'fast'").get()?.id as string;
  env.db
    .query(
      "INSERT INTO derivatives (media_id, variant, volume_id, path, mime, bytes) VALUES (?, 'thumb', ?, ?, 'image/webp', 1)",
    )
    .run(mediaId, fast, derivativeRelPath(sha, "thumb"));
  return sha;
};

test("GET /home: nombre, 'hoy hace X años' por fecha local y último viaje con fotos por miembro", async () => {
  env = await testEnv();
  setSetting(env.db, "gallery_name", "Galería de ejemplo");
  const p1 = addMember(env.db, "Persona 1");
  const p2 = addMember(env.db, "Persona 2");
  // 14/07 local (+02:00) aunque en UTC sea 13/07; hace 3 y 1 años.
  const a = addMedia(env.db, p1, { taken_at: "2023-07-13T23:30:00.000Z", taken_tz: "+02:00", taken_at_source: "exif" });
  const b = addMedia(env.db, p2, { taken_at: "2025-07-14T10:00:00.000Z", taken_at_source: "exif" });
  addMedia(env.db, p2, { taken_at: "2025-07-14T10:00:00.000Z", taken_at_source: "upload" }); // fecha de subida: no
  addMedia(env.db, p2, { taken_at: "2026-07-14T10:00:00.000Z", taken_at_source: "exif" }); // este año: no
  addMedia(env.db, p2, { taken_at: "2024-07-14T10:00:00.000Z", taken_at_source: "exif", deleted_at: "x" });
  for (let i = 0; i < 5; i++)
    addMedia(env.db, i < 3 ? p1 : p2, {
      taken_at: `2026-05-0${i + 1}T10:00:00.000Z`,
      taken_at_source: "exif",
      lat: 48.8584,
      lon: 2.2945,
    });
  assignTrips(env.db);
  const req = app({ now: () => new Date("2026-07-14T12:00:00.000Z") });
  const home = HomeResponse.parse(await (await req("/home")).json());
  expect(home.galleryName).toBe("Galería de ejemplo");
  expect(home.onThisDay.map((g) => [g.yearsAgo, g.media.map((m) => m.id)])).toEqual([
    [1, [b]],
    [3, [a]],
  ]);
  expect(home.lastTrip?.trip.count).toBe(5);
  expect(home.lastTrip?.perMember).toEqual([
    { memberId: p1, count: 3 },
    { memberId: p2, count: 2 },
  ]);
});

test("GET /places y /places/:id: conteo, tapa y grupos por viaje (las sueltas con trip null)", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  env.db
    .query(
      "INSERT INTO places (id, geoname_id, name, admin1, country_code, lat, lon) VALUES ('pl1', 1, 'Ciudad de ejemplo 1', '11', 'AA', 48.8, 2.3)",
    )
    .run();
  const viaje = Array.from({ length: 5 }, (_, i) =>
    addMedia(env.db, p, { taken_at: `2023-07-1${i}T10:00:00.000Z`, lat: 48.8584, lon: 2.2945, place_id: "pl1" }),
  );
  const suelta = addMedia(env.db, p, { taken_at: "2024-01-01T10:00:00.000Z", place_id: "pl1" });
  addMedia(env.db, p, { place_id: "pl1", deleted_at: "x" });
  const sha = thumbFor(suelta);
  assignTrips(env.db);
  const req = app();
  const places = (await (await req("/places")).json()) as { id: string; count: number; coverThumbUrl: string }[];
  expect(places).toHaveLength(1);
  expect(places[0]).toMatchObject({ id: "pl1", count: 6, countryCode: "AA", admin1: "11" });
  expect(places[0]?.coverThumbUrl).toContain(sha);

  const detail = PlaceDetail.parse(await (await req("/places/pl1")).json());
  expect(detail.groups.map((g) => [g.trip?.count ?? null, g.media.map((m) => m.id)])).toEqual([
    [null, [suelta]],
    [5, viaje],
  ]);
  expect((await req("/places/nada")).status).toBe(404);
});

test("GET /media: paginado estable por (fecha, id), con las sin fecha por fecha de subida, y filtros", async () => {
  env = await testEnv();
  const p1 = addMember(env.db, "Persona 1");
  const p2 = addMember(env.db, "Persona 2");
  const ids: string[] = [];
  for (let i = 0; i < 7; i++)
    ids.push(
      addMedia(env.db, i % 2 ? p2 : p1, {
        // Dos con la misma fecha (desempata el id) y una sin fecha de toma.
        taken_at: i === 6 ? null : `2023-01-0${Math.min(i, 4) + 1}T10:00:00.000Z`,
        uploaded_at: "2023-01-03T12:00:00.000Z",
        lat: i < 3 ? 1 : null,
      }),
    );
  addMedia(env.db, p1, { deleted_at: "x" });
  const req = app();
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = MediaPage.parse(await (await req(`/media?limit=3${cursor ? `&cursor=${cursor}` : ""}`)).json());
    seen.push(...page.items.map((m) => m.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(seen).toHaveLength(7);
  expect(new Set(seen).size).toBe(7);
  const keys = env.db
    .query<{ id: string; k: string }, []>(
      "SELECT id, COALESCE(taken_at, uploaded_at) AS k FROM media WHERE deleted_at IS NULL ORDER BY k DESC, id DESC",
    )
    .all();
  expect(seen).toEqual(keys.map((k) => k.id));

  const p2Only = MediaPage.parse(await (await req(`/media?memberId=${p2}`)).json());
  expect(p2Only.items.every((m) => m.memberId === p2)).toBe(true);
  const noLoc = MediaPage.parse(await (await req("/media?noLocation=1")).json());
  expect(noLoc.items).toHaveLength(4);
  expect((await req("/media?cursor=basura")).status).toBe(400);
  expect((await req("/media?limit=9999")).status).toBe(400);
});

test("favoritos: requieren miembro (409) y se reflejan en MediaItem y en el filtro", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const m = addMedia(env.db, p);
  const req = app();
  const sinMiembro = await req(`/media/${m}/favorite`, { method: "POST" });
  expect(sinMiembro.status).toBe(409);
  expect(((await sinMiembro.json()) as { error: string }).error).toBe("member_required");
  const fav = MediaItem.parse(await (await req(`/media/${m}/favorite`, { method: "POST", member: p })).json());
  expect(fav.favorite).toBe(true);
  expect(MediaPage.parse(await (await req("/media?favorites=1", { member: p })).json()).items).toHaveLength(1);
  expect((await req("/media?favorites=1")).status).toBe(409);
  await req(`/media/${m}/favorite`, { method: "DELETE", member: p });
  expect(MediaItem.parse(await (await req(`/media/${m}`, { member: p })).json()).favorite).toBe(false);
});

test("PATCH /media/:id/location y POST /media/location-bulk: manual, confirmada, limpia sugerencia y re-geocodifica", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const m = addMedia(env.db, p, {
    lat: 1,
    lon: 1,
    location_source: "suggested",
    suggested_from_media_id: "x",
    suggestion_confidence: 0.5,
  });
  const req = app();
  const res = await req(`/media/${m}/location`, { method: "PATCH", body: JSON.stringify({ lat: 10, lon: 20 }) });
  expect(MediaItem.parse(await res.json())).toMatchObject({
    lat: 10,
    lon: 20,
    locationSource: "manual",
    locationConfirmed: true,
  });
  const row = env.db
    .query<Record<string, unknown>, [string]>(
      "SELECT suggested_from_media_id, suggestion_confidence FROM media WHERE id = ?",
    )
    .get(m);
  expect(row).toEqual({ suggested_from_media_id: null, suggestion_confidence: null });
  expect(jobsOf(env.db, m)).toEqual([{ type: "geocode", status: "queued" }]);
  expect(jobsOf(env.db, null)).toEqual([{ type: "assign_trips", status: "queued" }]);
  expect(
    (await req(`/media/${m}/location`, { method: "PATCH", body: JSON.stringify({ lat: 100, lon: 0 }) })).status,
  ).toBe(400);

  const n = addMedia(env.db, p);
  const bulk = await req("/media/location-bulk", {
    method: "POST",
    body: JSON.stringify({ mediaIds: [m, n, "nada"], lat: 5, lon: 6 }),
  });
  expect(await bulk.json()).toEqual({ updated: 2 });
});

test("DELETE /media/:id: el original va a la papelera (mismo disco), se borran derivados y pares pendientes", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const rel = "originales/2023/07/2023-07-14_100000_persona-1_abcdef12.jpg";
  const m = addMedia(env.db, p, { original_path: rel });
  const otra = addMedia(env.db, p);
  await Bun.write(join(env.bulk, rel), "bytes originales");
  const sha = thumbFor(m);
  await Bun.write(join(env.fast, derivativeRelPath(sha, "thumb")), "webp");
  env.db
    .query("INSERT INTO similar_pairs (id, media_a, media_b, distance, created_at) VALUES ('sp1', ?, ?, 2, 'x')")
    .run(...[m, otra].sort());
  const req = app();
  expect((await req(`/media/${m}`, { method: "DELETE" })).status).toBe(204);
  expect(await Bun.file(join(env.bulk, rel)).exists()).toBe(false);
  expect(await Bun.file(join(env.bulk, "papelera", rel)).text()).toBe("bytes originales");
  expect(await Bun.file(join(env.fast, derivativeRelPath(sha, "thumb"))).exists()).toBe(false);
  const row = env.db
    .query<{ deleted_at: string | null; original_path: string }, [string]>(
      "SELECT deleted_at, original_path FROM media WHERE id = ?",
    )
    .get(m);
  expect(row?.deleted_at).not.toBeNull();
  expect(row?.original_path).toBe(join("papelera", rel));
  expect(env.db.query("SELECT * FROM derivatives").all()).toEqual([]);
  expect(env.db.query("SELECT * FROM similar_pairs").all()).toEqual([]);
  expect((await req(`/media/${m}`)).status).toBe(404);
  expect((await req(`/media/${m}`, { method: "DELETE" })).status).toBe(404);
});

test("borrar varias elegidas: cada una a la papelera; repetidas o inexistentes no cuentan", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const rels = ["originales/1.jpg", "originales/2.jpg", "originales/3.jpg"];
  const ids = rels.map((rel) => addMedia(env.db, p, { original_path: rel }));
  for (const rel of rels) await Bun.write(join(env.bulk, rel), "bytes");
  const req = app();
  const borrar = (mediaIds: string[]) =>
    req("/media/delete-bulk", { method: "POST", body: JSON.stringify({ mediaIds }) });
  const [a, b, c] = ids as [string, string, string];
  const res = await borrar([a, b, a, "01J0000000000000000000ZZZZ"]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: 2 });
  const vivos = env.db.query<{ id: string }, []>("SELECT id FROM media WHERE deleted_at IS NULL").all();
  expect(vivos.map((r) => r.id)).toEqual([c]);
  expect(await Bun.file(join(env.bulk, "papelera", rels[1] as string)).exists()).toBe(true);
  expect((await borrar([])).status).toBe(400);
});

test("borrar un lugar entero: solo con el nombre escrito; los originales van a la papelera", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  env.db
    .query(
      "INSERT INTO places (id, geoname_id, name, admin1, country_code, lat, lon) VALUES ('pl1', 1, 'Ciudad de Ejémplo', NULL, 'AA', 1, 1), ('pl2', 2, 'Otra ciudad', NULL, 'AA', 2, 2)",
    )
    .run();
  const rels = ["originales/a.jpg", "originales/b.jpg", "originales/c.jpg"];
  for (const rel of rels.slice(0, 2)) addMedia(env.db, p, { place_id: "pl1", original_path: rel });
  const otra = addMedia(env.db, p, { place_id: "pl2", original_path: rels[2] as string });
  for (const rel of rels) await Bun.write(join(env.bulk, rel), "bytes");
  const req = app();
  const borrar = (confirmName: string, id = "pl1") =>
    req(`/places/${id}/delete-all`, { method: "POST", body: JSON.stringify({ confirmName }) });

  const mal = await borrar("Ciudad");
  expect(mal.status).toBe(400);
  expect(((await mal.json()) as { error: string }).error).toBe("confirm_mismatch");
  expect(env.db.query("SELECT count(*) AS n FROM media WHERE deleted_at IS NULL").get()).toEqual({ n: 3 });

  expect((await borrar("x", "pl9")).status).toBe(404);
  // Sin importar mayúsculas, tildes ni espacios de más.
  const ok = await borrar("  ciudad de  ejemplo ");
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ deleted: 2 });
  const vivos = env.db.query<{ id: string }, []>("SELECT id FROM media WHERE deleted_at IS NULL").all();
  expect(vivos.map((r) => r.id)).toEqual([otra]);
  expect(await Bun.file(join(env.bulk, "papelera", rels[0] as string)).exists()).toBe(true);
  expect(await Bun.file(join(env.bulk, rels[2] as string)).exists()).toBe(true);
  // El lugar vacío ya no aparece en el globo.
  const places = (await (await req("/places")).json()) as { id: string }[];
  expect(places.map((x) => x.id)).toEqual(["pl2"]);
});

test("bandejas: sin ubicación (con sugerencia) y parecidos con su acción", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const desde = addMedia(env.db, p, { lat: 3, lon: 4, location_source: "gps", location_confirmed: 1 });
  const sug = addMedia(env.db, p, {
    lat: 3,
    lon: 4,
    location_source: "suggested",
    suggested_from_media_id: desde,
    suggestion_confidence: 0.8,
  });
  const sin = addMedia(env.db, p);
  const req = app();
  const inbox = (await (await req("/inbox/no-location")).json()) as {
    items: { media: { id: string }; suggestion: { fromMediaId: string; confidence: number } | null }[];
  };
  const byId = Object.fromEntries(inbox.items.map((i) => [i.media.id, i.suggestion]));
  expect(Object.keys(byId).sort()).toEqual([sug, sin].sort());
  expect(byId[sug]).toMatchObject({ fromMediaId: desde, confidence: 0.8, lat: 3, lon: 4 });
  expect(byId[sin]).toBeNull();

  env.db
    .query("INSERT INTO similar_pairs (id, media_a, media_b, distance, created_at) VALUES ('sp1', ?, ?, 3, 'x')")
    .run(...[desde, sin].sort());
  const sim = (await (await req("/inbox/similar")).json()) as {
    items: { id: string; distance: number; a: { id: string } }[];
  };
  expect(sim.items).toHaveLength(1);
  expect(sim.items[0]?.distance).toBe(3);
  expect((await req("/inbox/similar/sp1", { method: "POST", body: JSON.stringify({ action: "borrar" }) })).status).toBe(
    400,
  );
  expect(
    (await req("/inbox/similar/sp1", { method: "POST", body: JSON.stringify({ action: "kept_both" }) })).status,
  ).toBe(204);
  expect(((await (await req("/inbox/similar")).json()) as { items: unknown[] }).items).toEqual([]);
});

test("viajes: listar, detalle y renombrar (queda custom)", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  for (let i = 0; i < 5; i++)
    addMedia(env.db, p, { taken_at: `2023-07-1${i}T10:00:00.000Z`, lat: 48.8584, lon: 2.2945 });
  assignTrips(env.db);
  const req = app();
  const [trip] = (await (await req("/trips")).json()) as { id: string; count: number }[];
  expect(trip?.count).toBe(5);
  const detail = (await (await req(`/trips/${trip?.id}`)).json()) as { media: unknown[] };
  expect(detail.media).toHaveLength(5);
  const renamed = await req(`/trips/${trip?.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Nombre de ejemplo" }),
  });
  expect(await renamed.json()).toMatchObject({ name: "Nombre de ejemplo", nameIsCustom: true });
  assignTrips(env.db);
  expect(((await (await req(`/trips/${trip?.id}`)).json()) as { trip: { name: string } }).trip.name).toBe(
    "Nombre de ejemplo",
  );
});

test("admin: estado de la cola, errores, discos, gpu y reintentar fallidos", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const m = addMedia(env.db, p, { status: "error", error: "x" });
  const now = new Date().toISOString();
  const ins = env.db.query(
    "INSERT INTO jobs (id, type, media_id, priority, status, attempts, max_attempts, run_after, last_error, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 3, 3, ?, ?, ?, ?)",
  );
  ins.run("j1", "thumb", m, "failed", now, "vips falló", now, now);
  ins.run("j2", "preview", m, "queued", now, null, now, now);
  setSetting(env.db, "gpu", { nvenc: false, checkedAt: now });
  setSetting(env.db, "worker_seen_at", now);
  const req = app();
  const st = (await (await req("/admin/status")).json()) as {
    queue: { queued: number; failed: number; byType: Record<string, { queued: number }> };
    errors: { jobId: string; mediaId: string | null; type: string; error: string; at: string }[];
    volumes: { tier: string; totalBytes: number; alert: boolean }[];
    gpu: { nvenc: boolean };
    worker: { alive: boolean; seenAt: string | null };
  };
  expect(st.queue).toMatchObject({ queued: 1, failed: 1, byType: { preview: { queued: 1, running: 0 } } });
  expect(st.errors).toEqual([{ jobId: "j1", mediaId: m, type: "thumb", error: "vips falló", at: now }]);
  expect(st.volumes.map((v) => v.tier).sort()).toEqual(["bulk", "fast"]);
  expect(st.volumes[0]?.totalBytes).toBeGreaterThan(0);
  expect(st.gpu).toEqual({ nvenc: false });
  expect(st.worker).toEqual({ alive: true, seenAt: now });
  // Dos minutos sin latido: el worker se da por caído.
  const later = app({ now: () => new Date(Date.parse(now) + 120_000) });
  expect(((await (await later("/admin/status")).json()) as typeof st).worker.alive).toBe(false);

  expect(await (await req("/admin/jobs/retry", { method: "POST" })).json()).toEqual({ retried: 1 });
  expect(
    env.db.query<{ status: string; attempts: number }, []>("SELECT status, attempts FROM jobs WHERE id = 'j1'").get(),
  ).toEqual({
    status: "queued",
    attempts: 0,
  });
  expect(env.db.query<{ status: string }, [string]>("SELECT status FROM media WHERE id = ?").get(m)?.status).toBe(
    "processing",
  );
});

test("GET /events: SSE con eventos de cola y de medias terminadas", async () => {
  env = await testEnv();
  const m = addMedia(env.db, addMember(env.db), { status: "ready" });
  const req = app({ eventsIntervalMs: 20 });
  const ac = new AbortController();
  const res = await req("/events", { signal: ac.signal });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const later = new Date(Date.now() + 5).toISOString();
  await Bun.sleep(10);
  env.db
    .query(
      "INSERT INTO jobs (id, type, media_id, priority, status, attempts, max_attempts, run_after, created_at, updated_at) VALUES ('j', 'thumb', ?, 0, 'done', 1, 3, ?, ?, ?)",
    )
    .run(m, later, later, later);
  let text = "";
  const dec = new TextDecoder();
  while (!text.includes('"type":"media"')) text += dec.decode((await reader.read()).value);
  ac.abort();
  expect(text).toContain('"type":"queue"');
  expect(text).toContain(`{"type":"media","mediaId":"${m}","status":"ready","step":"thumb"}`);
});

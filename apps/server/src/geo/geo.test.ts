import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { loadConfig } from "../config";
import { addMedia, addMember, citiesTsv, HOME, jobsOf, TEST_CITIES, type TestEnv, testEnv } from "../worker/testing";
import { CityIndex, distanceKm, loadCities, parseCities } from "./cities";
import { geocode, resuggestAround, suggestLocation } from "./locate";
import { assignTrips, detectTrips, mergeTrips, splitTrip, type TripPoint } from "./trips";

let env: TestEnv;
afterEach(() => env?.cleanup());

// ── Geocodificación ────────────────────────────────────────────────

test("vecino más cercano con la grilla (incluye cruzar el antimeridiano)", () => {
  const idx = new CityIndex(parseCities(citiesTsv()));
  expect(idx.size).toBe(TEST_CITIES.length);
  expect(idx.nearest(48.85, 2.29)?.city.name).toBe("Ciudad de ejemplo 1");
  expect(idx.nearest(48.7, 2.05)?.city.name).toBe("Ciudad de ejemplo 4");
  expect(idx.nearest(-33.9, 151.2)?.city.name).toBe("Ciudad de ejemplo 2");
  // A -179.9 de longitud, la ciudad 6 (179.9) está a ~22 km y la 5 (-170.2) a ~1000 km.
  expect(idx.nearest(10.4, -179.9)?.city.name).toBe("Ciudad de ejemplo 6");
  // Lejos de todo igual encuentra algo.
  expect(idx.nearest(-80, -60)).not.toBeNull();
  expect(new CityIndex([]).nearest(0, 0)).toBeNull();
});

test("la grilla da lo mismo que fuerza bruta", () => {
  const cities = Array.from({ length: 400 }, (_, i) => ({
    geonameId: i,
    name: `Ciudad de ejemplo ${i}`,
    lat: ((i * 37) % 170) - 85,
    lon: ((i * 91) % 358) - 179,
    countryCode: "AA",
    admin1: "",
  }));
  const idx = new CityIndex(cities);
  for (let k = 0; k < 200; k++) {
    const lat = ((k * 13) % 160) - 80;
    const lon = ((k * 47) % 358) - 179;
    const brute = cities.reduce((b, c) =>
      distanceKm(lat, lon, c.lat, c.lon) < distanceKm(lat, lon, b.lat, b.lon) ? c : b,
    );
    expect(idx.nearest(lat, lon)?.city.geonameId).toBe(brute.geonameId);
  }
});

test("geocode crea o reutiliza el lugar y encola assign_trips con debounce", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const a = addMedia(env.db, p, { lat: 48.8584, lon: 2.2945, location_source: "gps" });
  const b = addMedia(env.db, p, { lat: 48.858, lon: 2.294, location_source: "gps" });
  await geocode(env.ctx, a);
  await geocode(env.ctx, b);
  const places = env.db.query<{ id: string; name: string; country_code: string; admin1: string }, []>(
    "SELECT id, name, country_code, admin1 FROM places",
  );
  expect(places.all()).toHaveLength(1);
  expect(places.get()).toMatchObject({ name: "Ciudad de ejemplo 1", country_code: "AA", admin1: "11" });
  const ids = env.db.query<{ place_id: string }, []>("SELECT DISTINCT place_id FROM media").all();
  expect(ids).toEqual([{ place_id: places.get()?.id as string }]);
  expect(jobsOf(env.db, null)).toEqual([{ type: "assign_trips", status: "queued" }]);
});

test("sin el archivo de cities500, error claro", async () => {
  env = await testEnv({ cities: false });
  const m = addMedia(env.db, addMember(env.db), { lat: 1, lon: 1 });
  expect(geocode(env.ctx, m)).rejects.toThrow(/cities500/);
  const config = loadConfig({ GEONAMES_PATH: join(env.dir, "nada.txt") });
  expect(loadCities(config.geonamesPath)).rejects.toThrow(/GEONAMES_PATH/);
});

// ── Sugerencia de ubicación ────────────────────────────────────────

const at = (h: number, min = 0) => new Date(Date.UTC(2023, 6, 14, h, min)).toISOString();

test("sugiere desde la foto con GPS de OTRO miembro más cercana en el tiempo, con confianza", async () => {
  env = await testEnv();
  const yo = addMember(env.db, "Persona 1");
  const otro = addMember(env.db, "Persona 2");
  addMedia(env.db, yo, { taken_at: at(10, 5), lat: 1, lon: 1, location_source: "gps" }); // mía: no cuenta
  const lejos = addMedia(env.db, otro, { taken_at: at(9), lat: 2, lon: 2, location_source: "gps" });
  const cerca = addMedia(env.db, otro, { taken_at: at(10, 30), lat: 3, lon: 3, location_source: "gps" });
  const m = addMedia(env.db, yo, { taken_at: at(10), taken_at_source: "exif" });
  expect(suggestLocation(env.db, m)).toBe(true);
  const r = env.db
    .query<Record<string, unknown>, [string]>(
      "SELECT lat, lon, location_source, location_confirmed, suggested_from_media_id, suggestion_confidence FROM media WHERE id = ?",
    )
    .get(m);
  expect(r).toMatchObject({
    lat: 3,
    lon: 3,
    location_source: "suggested",
    location_confirmed: 0,
    suggested_from_media_id: cerca,
  });
  expect(r?.suggestion_confidence).toBeCloseTo(0.75, 5); // 30 min de 2 h
  expect(lejos).not.toBe(cerca);
  expect(jobsOf(env.db, m)).toEqual([{ type: "geocode", status: "queued" }]);
});

test("fuera de ±2 h, solo fotos propias o con fecha de subida: no hay sugerencia", async () => {
  env = await testEnv();
  const yo = addMember(env.db, "Persona 1");
  const otro = addMember(env.db, "Persona 2");
  addMedia(env.db, otro, { taken_at: at(13, 1), lat: 2, lon: 2, location_source: "gps" });
  addMedia(env.db, yo, { taken_at: at(11), lat: 1, lon: 1, location_source: "gps" });
  const m = addMedia(env.db, yo, { taken_at: at(11), taken_at_source: "exif" });
  expect(suggestLocation(env.db, m)).toBe(false);
  const subida = addMedia(env.db, yo, { taken_at: at(13), taken_at_source: "upload" });
  expect(suggestLocation(env.db, subida)).toBe(false);
  expect(
    env.db.query<{ n: number }, []>("SELECT count(*) AS n FROM media WHERE location_source = 'suggested'").get()?.n,
  ).toBe(0);
});

test("una foto con GPS que llega después re-encola sugerencias para las de otros miembros", async () => {
  env = await testEnv();
  const yo = addMember(env.db, "Persona 1");
  const otro = addMember(env.db, "Persona 2");
  const sin = addMedia(env.db, yo, { taken_at: at(10), taken_at_source: "exif" });
  const propia = addMedia(env.db, otro, { taken_at: at(10), taken_at_source: "exif" });
  const gps = addMedia(env.db, otro, { taken_at: at(10, 20), lat: 2, lon: 2, location_source: "gps" });
  resuggestAround(env.db, gps, otro, at(10, 20));
  expect(jobsOf(env.db, sin)).toEqual([{ type: "suggest_location", status: "queued" }]);
  expect(jobsOf(env.db, propia)).toEqual([]);
});

// ── Viajes ─────────────────────────────────────────────────────────

const H = 3600_000;
const AWAY = { lat: 48.8584, lon: 2.2945 };
const pts = (n: number, start: number, step = H, where = AWAY): TripPoint[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${start}-${i}`, t: start + i * step, ...where }));

test("detectTrips: corta por más de 36 h sin fotos lejos de casa", () => {
  const trips = detectTrips([...pts(5, 0), ...pts(5, 4 * H + 37 * H)], HOME);
  expect(trips.map((t) => t.length)).toEqual([5, 5]);
  expect(detectTrips([...pts(5, 0), ...pts(5, 4 * H + 35 * H)], HOME).map((t) => t.length)).toEqual([10]);
});

test("detectTrips: una foto en casa entre medio corta el viaje", () => {
  const home: TripPoint = { id: "casa", t: 4.5 * H, ...HOME };
  expect(detectTrips([...pts(5, 0), home, ...pts(5, 5 * H)], HOME).map((t) => t.length)).toEqual([5, 5]);
});

test("detectTrips: menos de 5 fotos se descarta, y cerca de casa (< 30 km) no es viaje", () => {
  expect(detectTrips(pts(4, 0), HOME)).toEqual([]);
  expect(detectTrips(pts(10, 0, H, { lat: HOME.lat + 0.1, lon: HOME.lon }), HOME)).toEqual([]);
});

test("detectTrips: un rango unido a mano junta los grupos que toca, aunque haya uno chico en el medio", () => {
  const a = pts(5, 0);
  const chico = pts(3, 50 * H); // 3 fotos, a más de 36 h de cada lado
  const b = pts(5, 100 * H);
  expect(detectTrips([...a, ...chico, ...b], HOME).map((t) => t.length)).toEqual([5, 5]);
  const join = { start: 0, end: 104 * H };
  expect(detectTrips([...a, ...chico, ...b], HOME, [join]).map((t) => t.length)).toEqual([13]);
  // Un grupo fuera del rango sigue aparte.
  expect(detectTrips([...a, ...b, ...pts(5, 300 * H)], HOME, [join]).map((t) => t.length)).toEqual([10, 5]);
});

async function seedTrip(member: string, n: number, startIso: string, place?: string) {
  const ids: string[] = [];
  const t0 = Date.parse(startIso);
  for (let i = 0; i < n; i++)
    ids.push(
      addMedia(env.db, member, {
        taken_at: new Date(t0 + i * H).toISOString(),
        taken_tz: "+02:00",
        lat: AWAY.lat,
        lon: AWAY.lon,
        location_source: "gps",
        place_id: place ?? null,
      }),
    );
  return ids;
}
const tripOf = (id: string) =>
  env.db.query<{ trip_id: string | null }, [string]>("SELECT trip_id FROM media WHERE id = ?").get(id)?.trip_id;
const trips = () =>
  env.db
    .query<{ id: string; name: string; name_is_custom: number; cover_media_id: string }, []>(
      "SELECT id, name, name_is_custom, cover_media_id FROM trips ORDER BY start_at",
    )
    .all();

test("assignTrips: nombre con el lugar con más fotos y mes en español; tapa = favorita más reciente o la primera", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  env.db
    .query(
      "INSERT INTO places (id, geoname_id, name, admin1, country_code, lat, lon) VALUES ('pl1', 1, 'Ciudad de ejemplo 1', NULL, 'AA', 0, 0)",
    )
    .run();
  const ids = await seedTrip(p, 6, "2023-07-31T22:30:00.000Z", "pl1"); // local +02:00 → 1 de agosto
  assignTrips(env.db);
  expect(trips()).toMatchObject([{ name: "Ciudad de ejemplo 1, agosto 2023", cover_media_id: ids[0] }]);
  env.db
    .query("INSERT INTO favorites (member_id, media_id, created_at) VALUES (?, ?, ?)")
    .run(p, ids[3] as string, "2024-01-01");
  env.db
    .query("INSERT INTO favorites (member_id, media_id, created_at) VALUES (?, ?, ?)")
    .run(p, ids[1] as string, "2024-02-01");
  assignTrips(env.db);
  expect(trips()[0]?.cover_media_id).toBe(ids[1] as string);
});

test("assignTrips: reasignación estable (mismo id), el nombre custom no se pisa y los vacíos se borran", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const a = await seedTrip(p, 5, "2023-01-10T10:00:00.000Z");
  const b = await seedTrip(p, 5, "2023-03-10T10:00:00.000Z");
  assignTrips(env.db);
  const [ta, tb] = trips();
  expect(tripOf(a[0] as string)).toBe(ta?.id as string);
  expect(tripOf(b[0] as string)).toBe(tb?.id as string);
  env.db.query("UPDATE trips SET name = 'Nombre de ejemplo', name_is_custom = 1 WHERE id = ?").run(ta?.id as string);

  // Llegan más fotos al viaje A: mismo id, nombre custom intacto.
  await seedTrip(p, 3, "2023-01-10T16:00:00.000Z");
  assignTrips(env.db);
  expect(trips().map((t) => [t.id, t.name])).toEqual([
    [ta?.id as string, "Nombre de ejemplo"],
    [tb?.id as string, expect.stringContaining("marzo 2023")],
  ]);

  // Se borran las fotos de B: el viaje vacío desaparece. Las de A se borran: el custom queda (vacío).
  env.db.query(`UPDATE media SET deleted_at = 'x' WHERE id IN (${b.map(() => "?").join(",")})`).run(...b);
  assignTrips(env.db);
  expect(trips().map((t) => t.id)).toEqual([ta?.id as string]);
});

test("assignTrips: sin casa configurada no hace nada", async () => {
  env = await testEnv({ home: false });
  await seedTrip(addMember(env.db), 6, "2023-01-10T10:00:00.000Z");
  expect(assignTrips(env.db)).toEqual({ trips: 0 });
  expect(trips()).toEqual([]);
});

test("unir viajes: queda uno, con el nombre puesto a mano; las fotos nuevas del medio entran; separar lo deshace", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  await seedTrip(p, 6, "2023-07-01T08:00:00.000Z");
  await seedTrip(p, 6, "2023-07-05T08:00:00.000Z");
  assignTrips(env.db);
  const rows = () =>
    env.db
      .query<{ id: string; name: string; name_is_custom: number; start_at: string }, []>(
        "SELECT id, name, name_is_custom, start_at FROM trips ORDER BY start_at",
      )
      .all();
  const [a, b] = rows();
  expect(rows()).toHaveLength(2);
  env.db.query("UPDATE trips SET name = 'Vacaciones', name_is_custom = 1 WHERE id = ?").run(a?.id as string);

  const merged = mergeTrips(env.db, a?.id as string, b?.id as string);
  expect(rows()).toMatchObject([{ id: merged, name: "Vacaciones", name_is_custom: 1 }]);
  const count = () =>
    env.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM media WHERE trip_id = ?").get(merged as string)?.n;
  expect(count()).toBe(12);

  // Una foto que se sube después, de un día del medio, entra sola en el viaje unido.
  await seedTrip(p, 1, "2023-07-03T12:00:00.000Z");
  assignTrips(env.db);
  expect(rows()).toHaveLength(1);
  expect(count()).toBe(13);

  expect(splitTrip(env.db, merged as string)).toBe(true);
  expect(rows().map((t) => t.start_at)).toEqual([a?.start_at as string, b?.start_at as string]);
  expect(mergeTrips(env.db, a?.id as string, "no-existe")).toBeNull();
  expect(splitTrip(env.db, "no-existe")).toBe(false);
});

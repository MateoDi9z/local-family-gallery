// Ayudas para tests del área medios: base en memoria con volúmenes temporales y un cities500 SINTÉTICO.
import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";
import { loadConfig } from "../config";
import type { Ctx } from "../context";
import { migrate, openDb, setSetting } from "../db";
import { createLogger } from "../log";
import { syncVolumes } from "../storage";

/** Lugares de los fixtures (monumentos públicos) más algunos extra. Nombres genéricos. */
export const TEST_CITIES = [
  { id: 1001, name: "Ciudad de ejemplo 1", lat: 48.8584, lon: 2.2945, cc: "AA", admin1: "11" }, // Torre Eiffel
  { id: 1002, name: "Ciudad de ejemplo 2", lat: -33.8568, lon: 151.2153, cc: "BB", admin1: "02" }, // Ópera de Sídney
  { id: 1003, name: "Ciudad de ejemplo 3", lat: 41.8902, lon: 12.4922, cc: "CC", admin1: "07" }, // Coliseo: casa
  { id: 1004, name: "Ciudad de ejemplo 4", lat: 48.6, lon: 2.0, cc: "AA", admin1: "11" },
  { id: 1005, name: "Ciudad de ejemplo 5", lat: 10.5, lon: -170.2, cc: "DD", admin1: "" },
  { id: 1006, name: "Ciudad de ejemplo 6", lat: 10.4, lon: 179.9, cc: "EE", admin1: "" },
];
export const HOME = { lat: 41.8902, lon: 12.4922 };

/** Mismo formato que GeoNames: 19 columnas separadas por tab. */
export const citiesTsv = (cities = TEST_CITIES) =>
  cities
    .map((c) =>
      [
        c.id,
        c.name,
        c.name,
        "",
        c.lat,
        c.lon,
        "P",
        "PPL",
        c.cc,
        "",
        c.admin1,
        "",
        "",
        "",
        1000,
        "",
        10,
        "UTC",
        "2024-01-01",
      ].join("\t"),
    )
    .join("\n");

export type TestEnv = { ctx: Ctx; db: Database; dir: string; fast: string; bulk: string; cleanup: () => Promise<void> };

export async function testEnv(o: { home?: boolean; cities?: boolean } = {}): Promise<TestEnv> {
  const dir = await mkdtemp(join(tmpdir(), "lfg-medios-"));
  const fast = join(dir, "fast");
  const bulk = join(dir, "bulk1");
  const config = loadConfig({
    DATA_FAST_PATH: fast,
    DATA_BULK_PATHS: bulk,
    GEONAMES_PATH: join(dir, "cities500.txt"),
    WEB_DIST: "/nonexistent",
    GPU: "off",
  });
  if (o.cities !== false) await Bun.write(config.geonamesPath, citiesTsv());
  const db = openDb(":memory:");
  migrate(db);
  syncVolumes(db, config);
  if (o.home !== false) setSetting(db, "home", HOME);
  const ctx: Ctx = { db, config, log: createLogger("error") };
  return { ctx, db, dir, fast, bulk, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function addMember(db: Database, name = "Persona 1"): string {
  const id = ulid();
  db.query("INSERT INTO members (id, name, color, created_at) VALUES (?, ?, '#aa5500', ?)").run(
    id,
    name,
    new Date().toISOString(),
  );
  return id;
}

const randomSha = () => new Bun.CryptoHasher("sha256").update(ulid() + Math.random()).digest("hex");

/** Inserta una media con valores por defecto razonables. Las claves son columnas de `media`. */
export function addMedia(db: Database, memberId: string, fields: Record<string, string | number | null> = {}): string {
  const bulk = db.query<{ id: string }, []>("SELECT id FROM volumes WHERE tier = 'bulk' AND enabled = 1").get();
  const row: Record<string, string | number | null> = {
    id: ulid(),
    sha256: randomSha(),
    partial_hash: "0".repeat(64),
    kind: "photo",
    mime: "image/jpeg",
    size_bytes: 1,
    original_name: "foto.jpg",
    volume_id: bulk?.id ?? null,
    original_path: `originales/${ulid()}.jpg`,
    member_id: memberId,
    uploaded_at: new Date().toISOString(),
    ...fields,
  };
  const cols = Object.keys(row);
  db.query(`INSERT INTO media (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(
    ...(Object.values(row) as (string | number | null)[]),
  );
  return row.id as string;
}

export const jobsOf = (db: Database, mediaId: string | null) =>
  db
    .query<{ type: string; status: string }, [string | null]>(
      "SELECT type, status FROM jobs WHERE media_id IS ? ORDER BY created_at, id",
    )
    .all(mediaId);

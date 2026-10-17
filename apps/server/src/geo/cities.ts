// GeoNames cities500 local + vecino más cercano con un índice en grilla de 1° (PLAN §5). Offline.
import { existsSync } from "node:fs";

export type City = { geonameId: number; name: string; lat: number; lon: number; countryCode: string; admin1: string };

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const cellOf = (lat: number, lon: number) => [Math.floor(lat + 90), Math.floor(lon + 180)] as const;
const key = (y: number, x: number) => y * 360 + (((x % 360) + 360) % 360);

export class CityIndex {
  private grid = new Map<number, City[]>();
  readonly size: number;

  constructor(cities: City[]) {
    for (const c of cities) {
      const [y, x] = cellOf(c.lat, c.lon);
      const k = key(Math.min(y, 179), x);
      const cell = this.grid.get(k);
      if (cell) cell.push(c);
      else this.grid.set(k, [c]);
    }
    this.size = cities.length;
  }

  /** Ciudad más cercana, buscando en anillos de celdas hasta que ninguna celda más lejana pueda ganar. */
  nearest(lat: number, lon: number): { city: City; km: number } | null {
    const [cy, cx] = cellOf(lat, lon);
    let best: { city: City; km: number } | null = null;
    for (let r = 0; r <= 180; r++) {
      // Una celda del anillo r está al menos a (r-1)° del punto; en longitud un grado mide 111·cos(lat) km,
      // y se usa la latitud más polar del anillo (cerca de los polos se buscan más anillos).
      const minDegKm = 111 * Math.cos(rad(Math.min(89, Math.abs(lat) + r)));
      if (best && (r - 1) * minDegKm > best.km) break;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y > 179) continue;
        const edgeRow = y === cy - r || y === cy + r;
        const step = edgeRow ? 1 : 2 * r || 1;
        for (let x = cx - r; x <= cx + r; x += step) {
          for (const c of this.grid.get(key(y, x)) ?? []) {
            const km = distanceKm(lat, lon, c.lat, c.lon);
            if (!best || km < best.km) best = { city: c, km };
          }
        }
      }
    }
    return best;
  }
}

/** Parsea cities500.txt (TSV de GeoNames: id, name, ascii, alternates, lat, lon, …, country(8), …, admin1(10)). */
export function parseCities(text: string): City[] {
  const out: City[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    if (!f[1] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ geonameId: Number(f[0]), name: f[1], lat, lon, countryCode: f[8] ?? "", admin1: f[10] ?? "" });
  }
  return out;
}

const cache = new Map<string, Promise<CityIndex>>();

/** Carga (una vez por proceso) el índice desde `path`. Error claro si el archivo no está. */
export function loadCities(path: string): Promise<CityIndex> {
  let p = cache.get(path);
  if (!p) {
    p = (async () => {
      if (!existsSync(path))
        throw new Error(
          `No está el archivo de lugares de GeoNames (cities500.txt) en ${path}. Descargalo de download.geonames.org/export/dump/cities500.zip y descomprimilo ahí, o configurá GEONAMES_PATH.`,
        );
      return new CityIndex(parseCities(await Bun.file(path).text()));
    })();
    p.catch(() => cache.delete(path)); // si falta, se reintenta en el próximo trabajo
    cache.set(path, p);
  }
  return p;
}

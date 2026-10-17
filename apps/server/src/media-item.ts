// Fila de `media` → MediaItem del contrato. Lo usan ingesta (resumen del lote) y medios (vistas).
import type { Database } from "bun:sqlite";
import { type DerivativeVariant, fileUrl, type MediaItem, originalUrl } from "@lfg/shared";

/** Columnas que necesita `toMediaItem`. Usar `MEDIA_COLUMNS` en el SELECT (alias `m`). */
export const MEDIA_COLUMNS = `m.id, m.kind, m.sha256, m.original_name, m.member_id, m.taken_at, m.width, m.height,
  m.duration_ms, m.lat, m.lon, m.location_source, m.location_confirmed, m.place_id, m.trip_id, m.status`;

export type MediaRow = {
  id: string;
  kind: "photo" | "video";
  sha256: string;
  original_name: string;
  member_id: string;
  taken_at: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  lat: number | null;
  lon: number | null;
  location_source: "gps" | "suggested" | "manual" | null;
  location_confirmed: number;
  place_id: string | null;
  trip_id: string | null;
  status: "processing" | "ready" | "error";
};

export function toMediaItem(row: MediaRow, variants: ReadonlySet<string>, favorite: boolean): MediaItem {
  const url = (v: DerivativeVariant) => (variants.has(v) ? fileUrl(row.sha256, v) : null);
  return {
    id: row.id,
    kind: row.kind,
    sha256: row.sha256,
    originalName: row.original_name,
    memberId: row.member_id,
    takenAt: row.taken_at,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    lat: row.lat,
    lon: row.lon,
    locationSource: row.location_source,
    locationConfirmed: row.location_confirmed === 1,
    placeId: row.place_id,
    tripId: row.trip_id,
    status: row.status,
    favorite,
    thumbUrl: url("thumb"),
    previewUrl: url("preview"),
    posterUrl: url("poster"),
    videoUrl: url("video"),
    originalUrl: originalUrl(row.sha256),
  };
}

/** Convierte filas ya leídas, cargando derivados y favoritos en dos consultas. Mantiene el orden. */
export function toMediaItems(db: Database, rows: MediaRow[], memberId: string | null): MediaItem[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const variants = new Map<string, Set<string>>();
  for (const d of db
    .query<{ media_id: string; variant: string }, string[]>(
      `SELECT media_id, variant FROM derivatives WHERE media_id IN (${ph})`,
    )
    .all(...ids)) {
    const set = variants.get(d.media_id) ?? new Set<string>();
    set.add(d.variant);
    variants.set(d.media_id, set);
  }
  const favs = new Set(
    memberId
      ? db
          .query<{ media_id: string }, string[]>(
            `SELECT media_id FROM favorites WHERE member_id = ? AND media_id IN (${ph})`,
          )
          .all(memberId, ...ids)
          .map((f) => f.media_id)
      : [],
  );
  return rows.map((r) => toMediaItem(r, variants.get(r.id) ?? new Set(), favs.has(r.id)));
}

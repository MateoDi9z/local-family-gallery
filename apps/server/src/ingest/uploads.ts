// Prechequeo de duplicados, lotes y resumen del lote.
import { BatchCreate, type BatchSummary, endpoints, Id, type LocationSuggestion, PrecheckRequest } from "@lfg/shared";
import { Hono } from "hono";
import { ulid } from "ulid";
import type { AppEnv, Ctx } from "../context";
import { MEDIA_COLUMNS, type MediaRow, toMediaItems } from "../media-item";
import { body, fail } from "./common";

export function uploadRoutes(ctx: Ctx) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();

  r.post(endpoints.precheck, async (c) => {
    const { files } = await body(c, PrecheckRequest);
    const find = db.query<{ id: string }, [number, string]>(
      "SELECT id FROM media WHERE size_bytes = ? AND partial_hash = ? AND deleted_at IS NULL LIMIT 1",
    );
    return c.json(
      files.map((f) => {
        const hit = find.get(f.size, f.partialHash);
        return hit ? { exists: true, mediaId: hit.id } : { exists: false };
      }),
    );
  });

  r.post(endpoints.batches, async (c) => {
    const { source } = await body(c, BatchCreate);
    const memberId = c.get("memberId");
    if (!memberId) fail(409, "member_required", "Elegí quién sos antes de subir.");
    const id = ulid();
    db.query("INSERT INTO batches (id, member_id, device_id, source, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      memberId,
      c.get("deviceId"),
      source,
      new Date().toISOString(),
    );
    return c.json({ batchId: id }, 201);
  });

  r.get(`${endpoints.batches}/:id/summary`, (c) => {
    const batchId = Id.parse(c.req.param("id"));
    if (!db.query("SELECT 1 FROM batches WHERE id = ?").get(batchId))
      fail(404, "not_found", "No encontramos esa subida.");
    return c.json(batchSummary(ctx, batchId, c.get("memberId")));
  });

  return r;
}

type SummaryRow = MediaRow & {
  suggested_from_media_id: string | null;
  suggestion_confidence: number | null;
  place_name: string | null;
};

export function batchSummary(ctx: Ctx, batchId: string, memberId: string | null): BatchSummary {
  const { db } = ctx;
  const counts = db
    .query<{ total: number; dup: number | null; processing: number | null }, [string]>(
      `SELECT count(*) AS total, sum(bi.duplicate) AS dup, sum(m.status = 'processing') AS processing
       FROM batch_items bi JOIN media m ON m.id = bi.media_id WHERE bi.batch_id = ?`,
    )
    .get(batchId) ?? { total: 0, dup: 0, processing: 0 };
  const places = db
    .query<{ placeId: string; name: string; count: number }, [string]>(
      `SELECT p.id AS placeId, p.name, count(*) AS count
       FROM batch_items bi JOIN media m ON m.id = bi.media_id JOIN places p ON p.id = m.place_id
       WHERE bi.batch_id = ? AND m.deleted_at IS NULL
       GROUP BY p.id ORDER BY count DESC, p.name`,
    )
    .all(batchId);
  // Sin ubicación: sin coordenadas, o con una sugerida que nadie confirmó. Las que se están
  // procesando todavía no cuentan (no se leyó su GPS); el resumen las informa en processingCount.
  const rows = db
    .query<SummaryRow, [string]>(
      `SELECT ${MEDIA_COLUMNS}, m.suggested_from_media_id, m.suggestion_confidence, p.name AS place_name
       FROM batch_items bi JOIN media m ON m.id = bi.media_id LEFT JOIN places p ON p.id = m.place_id
       WHERE bi.batch_id = ? AND m.deleted_at IS NULL AND m.status <> 'processing'
         AND (m.lat IS NULL OR m.lon IS NULL OR (m.location_source = 'suggested' AND m.location_confirmed = 0))
       ORDER BY m.taken_at, m.id`,
    )
    .all(batchId);
  const items = toMediaItems(db, rows, memberId);
  return {
    batchId,
    total: counts.total,
    newCount: counts.total - (counts.dup ?? 0),
    duplicateCount: counts.dup ?? 0,
    processingCount: counts.processing ?? 0,
    places,
    noLocation: items.map((media, i) => ({ media, suggestion: suggestionOf(rows[i] as SummaryRow) })),
  };
}

function suggestionOf(r: SummaryRow): LocationSuggestion | null {
  if (r.location_source !== "suggested" || r.lat === null || r.lon === null || !r.suggested_from_media_id) return null;
  return {
    lat: r.lat,
    lon: r.lon,
    placeName: r.place_name,
    fromMediaId: r.suggested_from_media_id,
    confidence: Math.min(1, Math.max(0, r.suggestion_confidence ?? 0)),
  };
}

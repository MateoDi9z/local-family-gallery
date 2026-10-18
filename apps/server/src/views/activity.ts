// GET /activity (pantalla Subidas): lo que todavía no está listo y qué le falta, lo que falló y los últimos lotes.
// El contador de la cola casi siempre da 0 (una foto pasa por la cola en menos de un segundo): esto muestra
// cada foto hasta que esté lista.
import { type ActivityResponse, endpoints, JOB_PRIORITY, type JobType } from "@lfg/shared";
import { Hono } from "hono";
import type { AppEnv, Ctx } from "../context";
import { MEDIA_COLUMNS, type MediaRow, toMediaItems } from "../media-item";

/** Los pasos que cambian algo que se ve; los de fondo (parecidas, viajes) no cuentan como "procesándose". */
const VISIBLE: JobType[] = ["extract_metadata", "thumb", "video_poster", "preview", "video_transcode", "geocode"];
const inVisible = `j.type IN (${VISIBLE.map((v) => `'${v}'`).join(",")})`;
const PENDING = `EXISTS (SELECT 1 FROM jobs j WHERE j.media_id = m.id AND j.status IN ('queued', 'running') AND ${inVisible})`;
const NOT_READY = `m.deleted_at IS NULL AND (m.status = 'processing' OR ${PENDING})`;
const PROCESSING_LIMIT = 100;
const BATCHES = 10;
const BATCH_THUMBS = 8;

export function activityRoutes(ctx: Ctx) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();
  r.get(endpoints.activity, (c) => {
    const me = c.get("memberId");
    const rows = db
      .query<MediaRow, [number]>(
        `SELECT ${MEDIA_COLUMNS} FROM media m WHERE ${NOT_READY} ORDER BY m.uploaded_at DESC, m.id DESC LIMIT ?`,
      )
      .all(PROCESSING_LIMIT);
    const total = db.query<{ n: number }, []>(`SELECT count(*) AS n FROM media m WHERE ${NOT_READY}`).get()?.n ?? 0;
    const ids = rows.map((m) => m.id);
    const jobs = ids.length
      ? db
          .query<{ media_id: string; type: JobType; status: string }, string[]>(
            `SELECT j.media_id, j.type, j.status FROM jobs j
             WHERE j.status IN ('queued', 'running') AND ${inVisible} AND j.media_id IN (${ids.map(() => "?").join(",")})`,
          )
          .all(...ids)
      : [];
    const pending = new Map<string, { steps: JobType[]; running: boolean }>();
    for (const j of jobs) {
      const p = pending.get(j.media_id) ?? { steps: [], running: false };
      if (!p.steps.includes(j.type)) p.steps.push(j.type);
      p.running ||= j.status === "running";
      pending.set(j.media_id, p);
    }
    const processing = toMediaItems(db, rows, me).map((media) => {
      const p = pending.get(media.id) ?? { steps: [], running: false };
      return { media, steps: p.steps.sort((a, b) => JOB_PRIORITY[a] - JOB_PRIORITY[b]), running: p.running };
    });

    const failed = toMediaItems(
      db,
      db
        .query<MediaRow, []>(
          `SELECT ${MEDIA_COLUMNS} FROM media m WHERE m.deleted_at IS NULL AND m.status = 'error'
           ORDER BY m.uploaded_at DESC LIMIT 100`,
        )
        .all(),
      me,
    );

    const batchRows = db
      .query<
        {
          id: string;
          member_id: string;
          source: "web" | "share" | "shortcut" | "desktop";
          created_at: string;
          total: number;
          processing: number;
        },
        [number]
      >(
        `SELECT b.id, b.member_id, b.source, b.created_at, count(*) AS total, sum(m.status = 'processing') AS processing
         FROM batches b JOIN batch_items bi ON bi.batch_id = b.id AND bi.duplicate = 0
         JOIN media m ON m.id = bi.media_id AND m.deleted_at IS NULL
         GROUP BY b.id ORDER BY b.created_at DESC LIMIT ?`,
      )
      .all(BATCHES);
    const thumbs = db.query<MediaRow, [string, number]>(
      `SELECT ${MEDIA_COLUMNS} FROM batch_items bi JOIN media m ON m.id = bi.media_id
       WHERE bi.batch_id = ? AND bi.duplicate = 0 AND m.deleted_at IS NULL ORDER BY m.uploaded_at, m.id LIMIT ?`,
    );
    const batches = batchRows.map((b) => ({
      batchId: b.id,
      memberId: b.member_id,
      source: b.source,
      createdAt: b.created_at,
      total: b.total,
      processing: b.processing ?? 0,
      items: toMediaItems(db, thumbs.all(b.id, BATCH_THUMBS), me),
    }));

    const body: ActivityResponse = { processing, processingTotal: total, failed, batches };
    return c.json(body);
  });
  return r;
}

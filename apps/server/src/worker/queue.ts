// Cola de trabajos en SQLite (tabla `jobs`): lease, prioridades, reintentos con backoff y rescate de
// trabajos de workers muertos. Las fechas son ISO UTC y se comparan como texto (mismo formato siempre).
import type { Database } from "bun:sqlite";
import { type JobType, VIDEO_JOBS } from "@lfg/shared";
import { texts } from "../media/texts";

export type Job = {
  id: string;
  type: JobType;
  media_id: string | null;
  payload: string;
  attempts: number;
  max_attempts: number;
};

export type Pool = "image" | "video";

/** Si fallan del todo, la media queda en `error`: sin esto no se puede ver. */
export const CRITICAL_JOBS: ReadonlySet<string> = new Set(["extract_metadata", "thumb", "video_poster"]);

const BACKOFF_BASE_MS = 30_000;
const iso = (ms: number) => new Date(ms).toISOString();
const videoTypes = [...VIDEO_JOBS];
const ph = videoTypes.map(() => "?").join(",");

/**
 * Toma el próximo trabajo del pool (menor prioridad, después el más viejo) y lo marca `running` con lease.
 * Transacción IMMEDIATE: dos workers nunca toman el mismo. `attempts` se suma al tomar, así un trabajo
 * que mata al worker también cuenta.
 */
export function claim(db: Database, pool: Pool, workerId: string, leaseMs: number, now = Date.now()): Job | null {
  const filter = pool === "video" ? `type IN (${ph})` : `type NOT IN (${ph})`;
  return db
    .transaction(() => {
      const job = db
        .query<Job, (string | number)[]>(
          `SELECT id, type, media_id, payload, attempts, max_attempts FROM jobs
           WHERE status = 'queued' AND run_after <= ? AND ${filter}
           ORDER BY priority, run_after LIMIT 1`,
        )
        .get(iso(now), ...videoTypes);
      if (!job) return null;
      db.query(
        `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_by = ?, locked_until = ?, updated_at = ?
         WHERE id = ?`,
      ).run(workerId, iso(now + leaseMs), iso(now), job.id);
      return { ...job, attempts: job.attempts + 1 };
    })
    .immediate();
}

/** Extiende el lease de un trabajo largo (videos). */
export function heartbeat(db: Database, jobId: string, workerId: string, leaseMs: number, now = Date.now()): void {
  db.query("UPDATE jobs SET locked_until = ? WHERE id = ? AND locked_by = ? AND status = 'running'").run(
    iso(now + leaseMs),
    jobId,
    workerId,
  );
}

export function complete(db: Database, jobId: string, workerId: string, now = Date.now()): void {
  db.query(
    `UPDATE jobs SET status = 'done', locked_by = NULL, locked_until = NULL, last_error = NULL, updated_at = ?
     WHERE id = ? AND locked_by = ?`,
  ).run(iso(now), jobId, workerId);
}

/** Error: reintento con backoff exponencial (30 s · 2^intentos) o `failed` si se agotaron. */
export function fail(db: Database, job: Job, workerId: string, error: string, now = Date.now()): "retry" | "failed" {
  const final = job.attempts >= job.max_attempts;
  db.transaction(() => {
    db.query(
      `UPDATE jobs SET status = ?, run_after = ?, last_error = ?, locked_by = NULL, locked_until = NULL, updated_at = ?
       WHERE id = ? AND locked_by = ?`,
    ).run(
      final ? "failed" : "queued",
      iso(now + BACKOFF_BASE_MS * 2 ** job.attempts),
      error.slice(0, 2000),
      iso(now),
      job.id,
      workerId,
    );
    if (final) markMediaError(db, job.type, job.media_id);
  })();
  return final ? "failed" : "retry";
}

/** Apagado: el trabajo vuelve a la cola sin contar el intento. */
export function release(db: Database, jobId: string, workerId: string, now = Date.now()): void {
  db.query(
    `UPDATE jobs SET status = 'queued', attempts = MAX(attempts - 1, 0), locked_by = NULL, locked_until = NULL, updated_at = ?
     WHERE id = ? AND locked_by = ?`,
  ).run(iso(now), jobId, workerId);
}

function markMediaError(db: Database, type: string, mediaId: string | null) {
  if (!mediaId || !CRITICAL_JOBS.has(type)) return;
  db.query("UPDATE media SET status = 'error', error = ? WHERE id = ?").run(texts.mediaError[type] ?? null, mediaId);
}

/** Trabajos `running` con lease vencido (worker muerto) vuelven a la cola, o fallan si ya agotaron intentos. */
export function releaseExpired(db: Database, now = Date.now()): number {
  return db
    .transaction(() => {
      const stale = db
        .query<Job, [string]>(
          `SELECT id, type, media_id, payload, attempts, max_attempts FROM jobs
           WHERE status = 'running' AND locked_until < ?`,
        )
        .all(iso(now));
      for (const j of stale) {
        const final = j.attempts >= j.max_attempts;
        db.query(
          `UPDATE jobs SET status = ?, locked_by = NULL, locked_until = NULL, updated_at = ?,
             last_error = CASE WHEN ? THEN ? ELSE last_error END
           WHERE id = ?`,
        ).run(final ? "failed" : "queued", iso(now), final ? 1 : 0, texts.workerDied, j.id);
        if (final) markMediaError(db, j.type, j.media_id);
      }
      return stale.length;
    })
    .immediate();
}

/** Borra los `done` de hace más de `olderThanMs` (7 días por defecto). */
export function cleanupDone(db: Database, olderThanMs = 7 * 86_400_000, now = Date.now()): number {
  return db.query("DELETE FROM jobs WHERE status = 'done' AND updated_at < ?").run(iso(now - olderThanMs)).changes;
}

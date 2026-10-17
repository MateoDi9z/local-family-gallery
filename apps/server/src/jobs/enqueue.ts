// Encolar trabajos. Lo usan ingesta (al terminar una subida) y el worker (cadenas de trabajos).
import type { Database } from "bun:sqlite";
import { JOB_PRIORITY, type JobType } from "@lfg/shared";
import { ulid } from "ulid";

export type EnqueueOptions = { payload?: Record<string, unknown>; delayMs?: number; maxAttempts?: number };

export function enqueue(db: Database, type: JobType, mediaId: string | null, opts: EnqueueOptions = {}): string {
  const id = ulid();
  const now = new Date();
  const runAfter = new Date(now.getTime() + (opts.delayMs ?? 0)).toISOString();
  db.query(
    `INSERT INTO jobs (id, type, media_id, payload, priority, status, attempts, max_attempts, run_after, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
  ).run(
    id,
    type,
    mediaId,
    JSON.stringify(opts.payload ?? {}),
    JOB_PRIORITY[type],
    opts.maxAttempts ?? 3,
    runAfter,
    now.toISOString(),
    now.toISOString(),
  );
  return id;
}

/**
 * Encola un trabajo global (sin media) solo si no hay otro igual pendiente: sirve de debounce
 * (por ejemplo `assign_trips` cada 30 s como mucho).
 */
export function enqueueDebounced(db: Database, type: JobType, delayMs: number): string | null {
  const pending = db
    .query<{ id: string }, [string]>("SELECT id FROM jobs WHERE type = ? AND status = 'queued' LIMIT 1")
    .get(type);
  return pending ? null : enqueue(db, type, null, { delayMs });
}

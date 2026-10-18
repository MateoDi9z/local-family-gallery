// Worker de la cola: dos pools (imágenes y videos), detección de GPU, mantenimiento y apagado limpio.
import type { JobType } from "@lfg/shared";
import { ulid } from "ulid";
import type { Ctx } from "../context";
import { setSetting } from "../db";
import { geocode, suggestLocation } from "../geo/locate";
import { assignTrips } from "../geo/trips";
import { ExifTool } from "../media/exiftool";
import {
  extractMetadata,
  findSimilar,
  type JobEnv,
  phash,
  preview,
  thumb,
  videoPoster,
  videoTranscode,
} from "../media/pipeline";
import { nvencWorks } from "../media/video";
import { claim, cleanupDone, complete, fail, heartbeat, type Job, type Pool, release, releaseExpired } from "./queue";

const LEASE_MS = 60_000;
const HEARTBEAT_MS = 20_000;
const IDLE_POLL_MS = 500;
const RELEASE_EVERY_MS = 30_000;
const CLEANUP_EVERY_MS = 3600_000;

type Handler = (env: JobEnv, mediaId: string | null) => Promise<unknown> | unknown;
const need = (id: string | null) => {
  if (!id) throw new Error("el trabajo no tiene media_id");
  return id;
};

export const HANDLERS: Record<JobType, Handler> = {
  extract_metadata: (env, id) => extractMetadata(env, need(id)),
  thumb: (env, id) => thumb(env, need(id)),
  video_poster: (env, id) => videoPoster(env, need(id)),
  preview: (env, id) => preview(env, need(id)),
  video_transcode: (env, id) => videoTranscode(env, need(id)),
  phash: (env, id) => phash(env, need(id)),
  find_similar: (env, id) => findSimilar(env.ctx.db, need(id)),
  geocode: (env, id) => geocode(env.ctx, need(id)),
  suggest_location: (env, id) => suggestLocation(env.ctx.db, need(id)),
  assign_trips: (env) => assignTrips(env.ctx.db),
};

/** NVENC sí/no: con GPU=off no se prueba. Queda en `settings.gpu` para /admin/status. */
export async function detectGpu(ctx: Ctx): Promise<boolean> {
  const r = ctx.config.gpu === "off" ? { ok: false, reason: "GPU=off en la configuración" } : await nvencWorks();
  setSetting(ctx.db, "gpu", { nvenc: r.ok, checkedAt: new Date().toISOString() });
  ctx.log.info(r.ok ? "gpu: usando h264_nvenc" : "gpu: sin NVENC, se usa libx264 (CPU)", { reason: r.reason });
  return r.ok;
}

/** Corre un trabajo ya tomado: heartbeat mientras dura, y al final done / reintento / failed / devuelto. */
export async function runJob(env: JobEnv, job: Job, workerId: string): Promise<void> {
  const { db, log } = env.ctx;
  const hb = setInterval(() => heartbeat(db, job.id, workerId, LEASE_MS), HEARTBEAT_MS);
  const t0 = performance.now();
  try {
    await HANDLERS[job.type](env, job.media_id);
    complete(db, job.id, workerId);
    log.debug("trabajo listo", { type: job.type, jobId: job.id, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    if (env.signal?.aborted) {
      release(db, job.id, workerId);
      log.info("trabajo devuelto a la cola por apagado", { type: job.type, jobId: job.id });
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const r = fail(db, job, workerId, msg);
    log[r === "failed" ? "error" : "warn"](r === "failed" ? "trabajo falló" : "trabajo falló, se reintenta", {
      type: job.type,
      jobId: job.id,
      mediaId: job.media_id,
      attempt: job.attempts,
      err: msg.slice(0, 300),
    });
  } finally {
    clearInterval(hb);
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

async function slot(env: JobEnv & { signal: AbortSignal }, pool: Pool, workerId: string) {
  const { db, log } = env.ctx;
  while (!env.signal.aborted) {
    let job: Job | null = null;
    try {
      job = claim(db, pool, workerId, LEASE_MS);
    } catch (e) {
      log.warn("no se pudo tomar trabajo", { err: String(e) });
    }
    if (!job) {
      await sleep(IDLE_POLL_MS, env.signal);
      continue;
    }
    await runJob(env, job, workerId);
  }
}

export async function runWorker(ctx: Ctx, signal: AbortSignal): Promise<void> {
  const workerId = `worker-${ulid()}`;
  const nvenc = await detectGpu(ctx);
  const exif = new ExifTool();
  const env = { ctx, exif, nvenc, signal };

  const maintain = () => {
    try {
      setSetting(ctx.db, "worker_seen_at", new Date().toISOString());
      const n = releaseExpired(ctx.db);
      if (n) ctx.log.warn("trabajos de un worker muerto vuelven a la cola", { count: n });
    } catch (e) {
      ctx.log.warn("falló el mantenimiento de la cola", { err: String(e) });
    }
  };
  const cleanup = () => {
    try {
      cleanupDone(ctx.db);
    } catch (e) {
      ctx.log.warn("no se pudo limpiar la cola", { err: String(e) });
    }
  };
  maintain();
  cleanup();
  const timers = [setInterval(maintain, RELEASE_EVERY_MS), setInterval(cleanup, CLEANUP_EVERY_MS)];

  ctx.log.info("worker listo", {
    workerId,
    images: ctx.config.imageConcurrency,
    videos: ctx.config.videoConcurrency,
    nvenc,
  });
  const slots = [
    ...Array.from({ length: ctx.config.imageConcurrency }, () => slot(env, "image", workerId)),
    ...Array.from({ length: ctx.config.videoConcurrency }, () => slot(env, "video", workerId)),
  ];
  await Promise.all(slots);
  for (const t of timers) clearInterval(t);
  await exif.close();
  ctx.log.info("worker detenido");
}

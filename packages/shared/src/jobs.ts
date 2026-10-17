// Trabajos de la cola (tabla `jobs`). Menor prioridad = se ejecuta antes.
import { z } from "zod";

export const JobType = z.enum([
  "extract_metadata",
  "thumb",
  "video_poster",
  "geocode",
  "suggest_location",
  "preview",
  "phash",
  "find_similar",
  "assign_trips",
  "video_transcode",
]);
export type JobType = z.infer<typeof JobType>;

export const JOB_PRIORITY: Record<JobType, number> = {
  extract_metadata: 0,
  thumb: 0,
  video_poster: 0,
  geocode: 1,
  suggest_location: 1,
  preview: 2,
  phash: 2,
  find_similar: 3,
  assign_trips: 3,
  video_transcode: 5,
};

/** Trabajos que van en la cola de videos (concurrencia aparte). */
export const VIDEO_JOBS: ReadonlySet<JobType> = new Set(["video_transcode"]);

/** Todos llevan `media_id` en la fila salvo `assign_trips` (global). El payload es JSON libre por tipo. */
export const JobPayload = z.object({}).catchall(z.unknown());

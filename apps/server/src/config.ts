// Configuración solo por variables de entorno (documentadas en deploy/.env.example).
import { join, resolve } from "node:path";
import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATA_FAST_PATH: z.string().default("./data/fast"),
  DATA_BULK_PATHS: z.string().default("./data/bulk1"),
  GPU: z.enum(["auto", "off"]).default("auto"),
  WORKER_IMAGE_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  WORKER_VIDEO_CONCURRENCY: z.coerce.number().int().min(1).default(1),
  DISK_ALERT_PERCENT: z.coerce.number().min(1).max(100).default(85),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  WEB_DIST: z.string().default(join(import.meta.dir, "../../web/dist")),
  GEONAMES_PATH: z.string().optional(),
});

export type Config = {
  port: number;
  fastPath: string;
  bulkPaths: string[];
  dbPath: string;
  geonamesPath: string;
  gpu: "auto" | "off";
  imageConcurrency: number;
  videoConcurrency: number;
  diskAlertPercent: number;
  logLevel: "debug" | "info" | "warn" | "error";
  webDist: string;
  version: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const e = Env.parse(env);
  const fastPath = resolve(e.DATA_FAST_PATH);
  return {
    port: e.PORT,
    fastPath,
    bulkPaths: e.DATA_BULK_PATHS.split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => resolve(p)),
    dbPath: join(fastPath, "db", "galeria.sqlite"),
    geonamesPath: e.GEONAMES_PATH ? resolve(e.GEONAMES_PATH) : join(fastPath, "geonames", "cities500.txt"),
    gpu: e.GPU,
    imageConcurrency: e.WORKER_IMAGE_CONCURRENCY,
    videoConcurrency: e.WORKER_VIDEO_CONCURRENCY,
    diskAlertPercent: e.DISK_ALERT_PERCENT,
    logLevel: e.LOG_LEVEL,
    webDist: resolve(e.WEB_DIST),
    version: env.APP_VERSION ?? "dev",
  };
}

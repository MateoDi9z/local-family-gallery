import type { Database } from "bun:sqlite";
import type { Config } from "./config";
import type { Logger } from "./log";

/** Lo que reciben todos los módulos del servidor y del worker. */
export type Ctx = { db: Database; config: Config; log: Logger };

/** Variables de Hono que pone el middleware de autenticación (área ingesta). */
export type AppEnv = {
  Variables: {
    ctx: Ctx;
    deviceId: string | null;
    memberId: string | null;
  };
};

// Área ingesta: setup, auth, miembros, ajustes, subidas (tus), lotes, Atajo de iOS, /files y /cast.
import { Hono } from "hono";
import type { AppEnv, Ctx } from "../context";
import { authRoutes } from "./auth";
import { fileRoutes } from "./files";
import { shortcutRoutes } from "./shortcut";
import { tusRoutes } from "./tus";
import { uploadRoutes } from "./uploads";

export { authMiddleware } from "./auth";

export function ingestRoutes(ctx: Ctx) {
  return new Hono<AppEnv>()
    .route("/", authRoutes(ctx))
    .route("/", uploadRoutes(ctx))
    .route("/", tusRoutes(ctx))
    .route("/", fileRoutes(ctx))
    .route("/", shortcutRoutes(ctx));
}

// Esqueleto del servidor (coordinador). Cada área monta sus rutas desde su propio módulo.
import { API_PREFIX, endpoints } from "@lfg/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { AppEnv, Ctx } from "./context";
import { authMiddleware, ingestRoutes } from "./ingest";
import { viewRoutes } from "./views";
import { activityRoutes } from "./views/activity";
import { serveWeb } from "./web";

export function createApp(ctx: Ctx) {
  const api = new Hono<AppEnv>();
  api.use(async (c, next) => {
    c.set("ctx", ctx);
    c.set("deviceId", null);
    c.set("memberId", null);
    await next();
  });
  api.get(endpoints.health, (c) => c.json({ ok: true as const, version: ctx.config.version }));
  api.use(authMiddleware(ctx));
  api.route("/", ingestRoutes(ctx));
  api.route("/", viewRoutes(ctx));
  api.route("/", activityRoutes(ctx));
  api.notFound((c) => c.json({ error: "not_found", message: "No encontramos eso." }, 404));

  const app = new Hono<AppEnv>();
  app.onError((err, c) => {
    if (err instanceof ZodError)
      return c.json({ error: "invalid", message: "Faltan datos o hay alguno mal escrito." }, 400);
    if (err instanceof HTTPException) return err.getResponse();
    ctx.log.error("error no manejado", { path: c.req.path, err: String(err) });
    return c.json({ error: "internal", message: "Algo salió mal. Probá de nuevo en un rato." }, 500);
  });
  app.route(API_PREFIX, api);
  app.get("*", serveWeb(ctx.config.webDist));
  return app;
}

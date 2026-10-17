// Área ingesta: setup, auth, miembros, ajustes, subidas (tus), lotes, Atajo de iOS, /files y /cast.
// E1: solo el punto de montaje. Lo completa el agente ingesta en E2.
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppEnv, Ctx } from "../context";

/** Pone `deviceId` y `memberId` en el contexto y corta con 401 lo que requiere PIN. */
export function authMiddleware(_ctx: Ctx): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    await next();
  };
}

export function ingestRoutes(_ctx: Ctx) {
  return new Hono<AppEnv>();
}

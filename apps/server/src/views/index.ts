// Área medios: rutas de lectura (/home, /places, /trips, /media*), bandejas, /admin/status y /events.
// E1: solo el punto de montaje. Lo completa el agente medios en E2.
import { Hono } from "hono";
import type { AppEnv, Ctx } from "../context";

export function viewRoutes(_ctx: Ctx) {
  return new Hono<AppEnv>();
}

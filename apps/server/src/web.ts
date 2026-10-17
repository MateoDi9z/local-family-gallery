// Sirve el build de la web (apps/web/dist) con fallback a index.html para las rutas del SPA.
import { join, normalize } from "node:path";
import type { Context } from "hono";

export function serveWeb(dist: string) {
  return async (c: Context) => {
    const rel = normalize(decodeURIComponent(c.req.path)).replace(/^(\.\.[/\\])+/, "");
    const file = Bun.file(join(dist, rel));
    if (rel !== "/" && (await file.exists())) {
      // Los assets de Vite llevan hash en el nombre: caché larga.
      const immutable = rel.startsWith("/assets/");
      return new Response(file, {
        headers: { "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
      });
    }
    const index = Bun.file(join(dist, "index.html"));
    if (await index.exists()) return new Response(index, { headers: { "Cache-Control": "no-cache" } });
    return c.text("La web no está construida (bun run --cwd apps/web build).", 404);
  };
}

// /files (originales y derivados, con Range) y URLs firmadas para el Chromecast.
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CastSignRequest,
  DERIVATIVE_EXT,
  DerivativeVariant,
  endpoints,
  fileUrl,
  originalUrl,
  Sha256,
} from "@lfg/shared";
import { type Context, Hono } from "hono";
import type { AppEnv, Ctx } from "../context";
import { getSetting } from "../db";
import { absPath } from "../storage";
import { body, fail } from "./common";

export const CAST_TTL_S = 6 * 3600;

type FileVariant = DerivativeVariant | "original";

const castSig = (secret: string, sha256: string, variant: FileVariant, exp: number) =>
  createHmac("sha256", secret).update(`${sha256}/${variant}:${exp}`).digest("hex");

export function signFileUrl(secret: string, sha256: string, variant: FileVariant, exp: number): string {
  const path = variant === "original" ? originalUrl(sha256) : fileUrl(sha256, variant);
  return `${path}?exp=${exp}&sig=${castSig(secret, sha256, variant, exp)}`;
}

function validCastSig(secret: string | null, sha256: string, variant: FileVariant, exp?: string, sig?: string) {
  if (!secret || !exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(castSig(secret, sha256, variant, Number(exp)), "hex");
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** "thumb.webp" → "thumb", "original" → "original"; cualquier otra cosa → null. */
function parseVariant(name: string): FileVariant | null {
  if (name === "original") return "original";
  const [v = "", ext] = name.split(".");
  return (DerivativeVariant as readonly string[]).includes(v) && DERIVATIVE_EXT[v as DerivativeVariant] === ext
    ? (v as DerivativeVariant)
    : null;
}

/** proto://host como lo ve el cliente (detrás de Caddy, con los X-Forwarded-*). */
function origin(c: Context) {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || c.req.header("host") || url.host;
  return `${proto}://${host}`;
}

export function fileRoutes(ctx: Ctx) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();

  r.on(["GET", "HEAD"], "/files/:sha256/:name", async (c) => {
    const sha256 = c.req.param("sha256");
    const variant = parseVariant(c.req.param("name"));
    if (!Sha256.safeParse(sha256).success || !variant) fail(404, "not_found", "No encontramos ese archivo.");
    if (
      !c.get("deviceId") &&
      !validCastSig(getSetting<string>(db, "cast_secret"), sha256, variant, c.req.query("exp"), c.req.query("sig"))
    )
      fail(401, "pin_required", "Ingresá el PIN familiar para ver esta foto.");

    const row =
      variant === "original"
        ? db
            .query<{ volume_id: string; path: string; mime: string; original_name: string }, [string]>(
              `SELECT volume_id, original_path AS path, mime, original_name FROM media
               WHERE sha256 = ? AND deleted_at IS NULL`,
            )
            .get(sha256)
        : db
            .query<{ volume_id: string; path: string; mime: string; original_name: string }, [string, string]>(
              `SELECT d.volume_id, d.path, d.mime, m.original_name FROM derivatives d JOIN media m ON m.id = d.media_id
               WHERE m.sha256 = ? AND d.variant = ? AND m.deleted_at IS NULL`,
            )
            .get(sha256, variant);
    if (!row) fail(404, "not_found", "No encontramos ese archivo.");
    const file = Bun.file(absPath(db, row.volume_id, row.path));
    if (!(await file.exists())) fail(404, "not_found", "No encontramos ese archivo.");

    const headers: Record<string, string> = {
      "Content-Type": row.mime,
      "Accept-Ranges": "bytes",
      // Pisa el que pone Bun, que expone el nombre en disco.
      "Content-Disposition":
        variant === "original" ? `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}` : "inline",
      "Cache-Control": variant === "original" ? "private, max-age=3600" : "private, max-age=31536000, immutable",
    };
    // Hono responde los HEAD como GET sin body y con Content-Length 0: va el real a mano.
    if (c.req.method === "HEAD")
      return new Response(null, { headers: { ...headers, "Content-Length": String(file.size) } });
    // Bun.serve resuelve solo el Range (206, sufijo y 416).
    return new Response(file, { headers });
  });

  r.post(endpoints.castSign, async (c) => {
    const { mediaIds } = await body(c, CastSignRequest);
    const secret = getSetting<string>(db, "cast_secret");
    if (!secret) fail(409, "setup_required", "Primero hay que terminar la configuración inicial.");
    const exp = Math.floor(Date.now() / 1000) + CAST_TTL_S;
    const base = origin(c);
    const media = db.query<{ id: string; sha256: string; kind: string; mime: string }, [string]>(
      "SELECT id, sha256, kind, mime FROM media WHERE id = ? AND deleted_at IS NULL",
    );
    const derivs = db.query<{ variant: DerivativeVariant; mime: string }, [string]>(
      "SELECT variant, mime FROM derivatives WHERE media_id = ?",
    );
    const items = mediaIds.flatMap((id) => {
      const m = media.get(id);
      if (!m) return [];
      const d = new Map(derivs.all(id).map((x) => [x.variant, x.mime]));
      // Video convertido o versión mediana; si todavía no existe, el original.
      const main: DerivativeVariant = m.kind === "video" ? "video" : "preview";
      const variant: FileVariant = d.has(main) ? main : "original";
      const poster = d.has("poster") ? "poster" : d.has("thumb") ? "thumb" : null;
      return [
        {
          mediaId: id,
          url: base + signFileUrl(secret, m.sha256, variant, exp),
          contentType: variant === "original" ? m.mime : (d.get(main) as string),
          posterUrl: poster ? base + signFileUrl(secret, m.sha256, poster, exp) : null,
        },
      ];
    });
    return c.json({ items });
  });

  return r;
}

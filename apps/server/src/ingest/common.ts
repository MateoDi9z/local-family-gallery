// Utilidades compartidas del área ingesta.
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

/** Formatos aceptados (por extensión: iOS a veces manda un `filetype` genérico). */
export const MEDIA_TYPES: Record<string, { kind: "photo" | "video"; mime: string }> = {
  heic: { kind: "photo", mime: "image/heic" },
  heif: { kind: "photo", mime: "image/heif" },
  jpg: { kind: "photo", mime: "image/jpeg" },
  jpeg: { kind: "photo", mime: "image/jpeg" },
  png: { kind: "photo", mime: "image/png" },
  webp: { kind: "photo", mime: "image/webp" },
  mov: { kind: "video", mime: "video/quicktime" },
  mp4: { kind: "video", mime: "video/mp4" },
  m4v: { kind: "video", mime: "video/x-m4v" },
  "3gp": { kind: "video", mime: "video/3gpp" },
};

export const UNSUPPORTED_MESSAGE = "Solo se pueden subir fotos y videos (HEIC, JPG, PNG, WebP, MOV, MP4).";

export const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
export const mediaTypeOf = (name: string) => {
  const ext = extOf(name);
  return Object.hasOwn(MEDIA_TYPES, ext) ? MEDIA_TYPES[ext] : null;
};

export const sha256Hex = (data: string) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** SHA-256 de un archivo en streaming (no lo carga entero en memoria). */
export async function hashFile(path: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) h.update(chunk);
  return h.digest("hex");
}

const MIB = 1024 * 1024;

/**
 * El mismo `partialHash` de @lfg/shared, leyendo del disco. No se usa el compartido con `Bun.file`
 * porque en Bun 1.4.3 `new Blob([Uint8Array, Bun.file(p)])` descarta el archivo (da otro hash).
 * El test compara los dos.
 */
export async function partialHashFile(path: string): Promise<string> {
  const f = Bun.file(path);
  const head = new Uint8Array(8);
  new DataView(head.buffer).setBigUint64(0, BigInt(f.size));
  const h = new Bun.CryptoHasher("sha256").update(head);
  if (f.size <= 2 * MIB) h.update(await f.arrayBuffer());
  else h.update(await f.slice(0, MIB).arrayBuffer()).update(await f.slice(f.size - MIB, f.size).arrayBuffer());
  return h.digest("hex");
}

/** 32 bytes aleatorios en base64url. */
export const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/** Corta el request con `{ error, message }`. El `message` se le muestra a la persona. */
export function fail(status: ContentfulStatusCode, error: string, message: string): never {
  throw new HTTPException(status, { res: Response.json({ error, message }, { status }) });
}

/** Body JSON validado. Un JSON roto cae en el 400 de zod, no en un 500. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  return schema.parse(await c.req.json().catch(() => undefined));
}

/** IP del cliente: la última de X-Forwarded-For (la pone Caddy) o la del socket. */
export function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
  const server = c.env as { requestIP?: (r: Request) => { address: string } | null } | undefined;
  return xff || server?.requestIP?.(c.req.raw)?.address || "local";
}

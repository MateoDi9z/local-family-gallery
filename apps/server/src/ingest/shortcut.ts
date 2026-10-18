// Atajo de iOS: tokens por miembro y subida multipart con Bearer.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { endpoints, ShortcutTokenCreate } from "@lfg/shared";
import { Hono } from "hono";
import { ulid } from "ulid";
import type { AppEnv, Ctx } from "../context";
import { pickBulkVolume, tusTmpDir } from "../storage";
import { getMember } from "./auth";
import { body, fail, mediaExtOf, randomToken, sha256Hex, UNSUPPORTED_MESSAGE } from "./common";
import { finalizeUpload } from "./finalize";
import { type Part, parseMultipart } from "./multipart";

type TokenRow = { id: string; member_id: string; label: string; created_at: string; revoked_at: string | null };
const toToken = (r: TokenRow) => ({
  id: r.id,
  memberId: r.member_id,
  label: r.label,
  createdAt: r.created_at,
  revoked: r.revoked_at !== null,
});

export function shortcutRoutes(ctx: Ctx) {
  const { db, log } = ctx;
  const r = new Hono<AppEnv>();
  const tokenRow = (id: string) =>
    db
      .query<TokenRow, [string]>("SELECT id, member_id, label, created_at, revoked_at FROM api_tokens WHERE id = ?")
      .get(id);

  r.get(endpoints.shortcutTokens, (c) =>
    c.json(
      db
        .query<TokenRow, []>(
          "SELECT id, member_id, label, created_at, revoked_at FROM api_tokens ORDER BY created_at, rowid",
        )
        .all()
        .map(toToken),
    ),
  );

  r.post(endpoints.shortcutTokens, async (c) => {
    const b = await body(c, ShortcutTokenCreate);
    const m = getMember(db, b.memberId);
    if (!m || m.archived_at) fail(400, "member_invalid", "Esa persona no está en la galería. Elegí otra.");
    const token = randomToken();
    const id = ulid();
    db.query("INSERT INTO api_tokens (id, member_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      b.memberId,
      sha256Hex(token),
      b.label,
      new Date().toISOString(),
    );
    // El token en claro sale solo esta vez; en la base queda su SHA-256.
    return c.json({ ...toToken(tokenRow(id) as TokenRow), token }, 201);
  });

  r.delete(`${endpoints.shortcutTokens}/:id`, (c) => {
    const id = c.req.param("id");
    if (!tokenRow(id)) fail(404, "not_found", "No encontramos ese Atajo.");
    db.query("UPDATE api_tokens SET revoked_at = coalesce(revoked_at, ?) WHERE id = ?").run(
      new Date().toISOString(),
      id,
    );
    return c.body(null, 204);
  });

  // Bun arma el multipart en memoria: el límite es maxRequestBodySize de Bun.serve (4 GiB, main.ts).
  r.post(endpoints.shortcutUpload, async (c) => {
    const bearer = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const tok = bearer
      ? db
          .query<{ member_id: string }, [string]>(
            "SELECT member_id FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL",
          )
          .get(sha256Hex(bearer))
      : null;
    if (!tok) fail(401, "token_invalid", "El Atajo no tiene permiso. Volvé a crearlo desde la galería.");
    const member = getMember(db, tok.member_id);
    if (!member || member.archived_at)
      fail(403, "member_invalid", "La persona de este Atajo ya no está en la galería. Creá uno nuevo.");

    // Multipart a mano: el Atajo puede mandar el archivo sin `filename`, y formData() lo volvería texto.
    const parts = parseMultipart(new Uint8Array(await c.req.arrayBuffer()), c.req.header("content-type") ?? "");
    // El formato sale del contenido; el nombre puede faltar o tener la extensión de antes de convertirse.
    const isMedia = (p: Part) => mediaExtOf(p.data.subarray(0, 16), p.filename) !== null;
    // Cuenta toda parte "file" (lo que pide la guía) y cualquier otra que sea una foto o un video.
    const all = parts.filter((p) => p.name === "file" || isMedia(p));
    // Los formatos que no entendemos se saltean: el resto se sube igual.
    const files = all.filter(isMedia);
    if (all.length > files.length)
      log.warn("atajo: archivos salteados por formato", { count: all.length - files.length });
    if (!files.length)
      fail(
        all.length ? 415 : 400,
        all.length ? "unsupported_type" : "no_files",
        all.length ? UNSUPPORTED_MESSAGE : "No llegó ningún archivo.",
      );

    const batchId = ulid();
    db.query(
      "INSERT INTO batches (id, member_id, device_id, source, created_at) VALUES (?, ?, NULL, 'shortcut', ?)",
    ).run(batchId, tok.member_id, new Date().toISOString());
    const items = [];
    for (const f of files) {
      // Mismo camino que tus: temporal en un disco bulk y la misma finalización.
      const tmpPath = join(tusTmpDir(await pickBulkVolume(db)), `shortcut-${ulid()}`);
      try {
        await Bun.write(tmpPath, f.data);
        const res = await finalizeUpload(ctx, { tmpPath, batchId, name: f.filename });
        items.push({ name: f.filename, ...res });
      } catch (e) {
        await rm(tmpPath, { force: true });
        log.error("atajo: falló un archivo", { err: String(e) });
        fail(500, "upload_failed", `No pudimos guardar "${f.filename || "un archivo"}". Probá mandarlo de nuevo.`);
      }
    }
    return c.json({ batchId, items });
  });

  return r;
}

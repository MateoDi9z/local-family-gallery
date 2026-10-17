// Subidas reanudables con tus (@tus/server sobre Hono, ver DECISIONES E0).
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { API_PREFIX, endpoints, TusMetadata } from "@lfg/shared";
import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { type Context, Hono } from "hono";
import type { AppEnv, Ctx } from "../context";
import { listVolumes, pickBulkVolume, tusTmpDir } from "../storage";
import { mediaTypeOf, UNSUPPORTED_MESSAGE } from "./common";
import { finalizeUpload } from "./finalize";

export const TUS_MAX_SIZE = 20 * 1024 ** 3;
export const TUS_EXPIRATION_MS = 7 * 24 * 3600 * 1000;
// Una subida completa que sigue en tmp/ después de esto es porque falló la finalización: se reintenta.
const RETRY_FINALIZE_AFTER_MS = 10 * 60 * 1000;
const SHORTCUT_TMP_MAX_AGE_MS = 24 * 3600 * 1000;

const tusError = (status_code: number, error: string, message: string) => ({
  status_code,
  body: JSON.stringify({ error, message }),
});

type RawMeta = Record<string, string | null> | undefined;
const parseMeta = (m: RawMeta) =>
  TusMetadata.safeParse(Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => v != null)));

/** Finaliza una subida tus terminada y borra su `.json`. */
async function finishTus(ctx: Ctx, dir: string, id: string, meta: RawMeta) {
  const m = parseMeta(meta);
  if (!m.success) throw new Error("metadata tus inválida");
  const res = await finalizeUpload(ctx, {
    tmpPath: join(dir, id),
    batchId: m.data.batchId,
    name: m.data.filename,
    lastModified: m.data.lastModified ? Number(m.data.lastModified) : undefined,
  });
  await rm(join(dir, `${id}.json`), { force: true });
  return res;
}

export function tusRoutes(ctx: Ctx) {
  const { db, log } = ctx;
  // El hook de tus recibe el Request crudo: por acá le llega quién está subiendo.
  const uploaders = new WeakMap<object, { memberId: string | null }>();

  const init = async () => {
    // Temporales en el disco bulk con más espacio al arrancar; el final suele ser un rename.
    const dir = tusTmpDir(await pickBulkVolume(db));
    return new Server({
      path: API_PREFIX + endpoints.tus,
      // Sin expiración de FileStore: la limpieza propia (sweepTus) usa el tamaño real en disco.
      datastore: new FileStore({ directory: dir }),
      respectForwardedHeaders: true,
      maxSize: TUS_MAX_SIZE,
      async onUploadCreate(req, upload) {
        const who = uploaders.get(req);
        if (!who?.memberId) throw tusError(409, "member_required", "Elegí quién sos antes de subir.");
        const m = parseMeta(upload.metadata);
        if (!m.success) throw tusError(400, "invalid", "Faltan datos del archivo. Probá subirlo de nuevo.");
        if (!mediaTypeOf(m.data.filename))
          throw tusError(415, "unsupported_type", `No podemos guardar "${m.data.filename}". ${UNSUPPORTED_MESSAGE}`);
        if (upload.size === 0) throw tusError(400, "empty_file", `"${m.data.filename}" está vacío.`);
        const batch = db
          .query<{ member_id: string }, [string]>("SELECT member_id FROM batches WHERE id = ?")
          .get(m.data.batchId);
        if (!batch || batch.member_id !== who.memberId)
          throw tusError(403, "batch_invalid", "Esta subida no es tuya. Volvé a empezar desde Subir.");
        return {};
      },
      async onUploadFinish(_req, upload) {
        try {
          const r = await finishTus(ctx, dir, upload.id, upload.metadata);
          return { headers: { "Upload-Media-Id": r.mediaId, "Upload-Duplicate": String(r.duplicate) } };
        } catch (e) {
          log.error("falló la finalización de una subida", { uploadId: upload.id, err: String(e) });
          throw tusError(
            500,
            "finalize_failed",
            "No pudimos guardar el archivo. Se va a reintentar solo en unos minutos.",
          );
        }
      },
    });
  };
  // Se arma con el primer request: si falla (sin discos), el siguiente lo reintenta.
  let server: Promise<Server> | undefined;
  const getServer = () =>
    (server ??= init().catch((e) => {
      server = undefined;
      throw e;
    }));

  const sweep = () => sweepTus(ctx).catch((e) => log.error("falló la limpieza de tus", { err: String(e) }));
  sweep();
  setInterval(sweep, 3600_000).unref();

  const r = new Hono<AppEnv>();
  const handle = async (c: Context<AppEnv>) => {
    uploaders.set(c.req.raw, { memberId: c.get("memberId") });
    return (await getServer()).handleWeb(c.req.raw);
  };
  r.all(endpoints.tus, handle);
  r.all(`${endpoints.tus}/*`, handle);
  return r;
}

/**
 * Limpieza de `tmp/tus` en todos los discos bulk:
 * - subidas incompletas de más de 7 días → se borran;
 * - subidas completas que no se finalizaron (se cayó algo) → se reintenta la finalización;
 * - temporales del Atajo huérfanos de más de 1 día → se borran (el Atajo no recibió respuesta y reintenta).
 */
export async function sweepTus(ctx: Ctx, now = Date.now()): Promise<void> {
  for (const vol of listVolumes(ctx.db).filter((v) => v.tier === "bulk")) {
    const dir = tusTmpDir(vol);
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      const path = join(dir, name);
      try {
        if (name.startsWith("shortcut-")) {
          if (now - Bun.file(path).lastModified > SHORTCUT_TMP_MAX_AGE_MS) await rm(path, { force: true });
          continue;
        }
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -5);
        const data = Bun.file(join(dir, id));
        if (!(await data.exists())) {
          await rm(path, { force: true });
          continue;
        }
        const info = JSON.parse(await readFile(path, "utf8")) as {
          size?: number;
          metadata?: RawMeta;
          creation_date?: string;
        };
        if (info.size !== undefined && data.size === info.size) {
          if (now - data.lastModified > RETRY_FINALIZE_AFTER_MS) {
            await finishTus(ctx, dir, id, info.metadata);
            ctx.log.info("finalización de subida reintentada", { uploadId: id });
          }
        } else if (now - Date.parse(info.creation_date ?? "") > TUS_EXPIRATION_MS) {
          await rm(join(dir, id), { force: true });
          await rm(path, { force: true });
          ctx.log.info("subida incompleta vencida, borrada", { uploadId: id });
        }
      } catch (e) {
        ctx.log.warn("no se pudo revisar un temporal de tus", { name, err: String(e) });
      }
    }
  }
}

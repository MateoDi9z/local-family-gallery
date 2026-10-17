// Ayudas para los tests de ingesta: app real con base en memoria y discos en carpetas temporales.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEVICE_COOKIE, type Member } from "@lfg/shared";
import * as tus from "tus-js-client";
import { createApp } from "../app";
import { loadConfig } from "../config";
import type { Ctx } from "../context";
import { migrate, openDb } from "../db";
import { createLogger } from "../log";
import { syncVolumes } from "../storage";

export const SETUP = {
  galleryName: "Galería de ejemplo",
  members: [
    { name: "Persona 1", color: "#ff8800" },
    { name: "Persona 2", color: "#0088ff" },
  ],
  home: { lat: 10, lon: 20 },
  pin: "1234",
};

export async function makeEnv(bulkCount = 1) {
  const dir = await mkdtemp(join(tmpdir(), "lfg-ing-"));
  const bulk = Array.from({ length: bulkCount }, (_, i) => join(dir, `b${i + 1}`));
  const config = loadConfig({
    DATA_FAST_PATH: join(dir, "fast"),
    DATA_BULK_PATHS: bulk.join(","),
    WEB_DIST: "/nonexistent",
  });
  const db = openDb(":memory:");
  migrate(db);
  syncVolumes(db, config);
  const ctx: Ctx = { db, config, log: createLogger("error") };
  return { dir, bulk, ctx, db, app: createApp(ctx) };
}

type App = ReturnType<typeof createApp>;
type ReqInit = { method?: string; json?: unknown; headers?: Record<string, string>; body?: BodyInit };

/** Cliente con la cookie de dispositivo, como un navegador. */
export function client(app: App) {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async req(path: string, init: ReqInit = {}) {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      if (init.json !== undefined) headers.set("content-type", "application/json");
      const res = await app.request(path, {
        method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      });
      const m = res.headers.get("set-cookie")?.match(new RegExp(`${DEVICE_COOKIE}=([^;]+)`));
      if (m) cookie = `${DEVICE_COOKIE}=${m[1]}`;
      return res;
    },
  };
}

/** Asistente hecho, dispositivo autenticado y con "Persona 1" elegida. */
export async function setupGallery(app: App) {
  const c = client(app);
  await c.req("/api/setup", { json: SETUP });
  const members = (await (await c.req("/api/members")).json()) as Member[];
  await c.req("/api/me/member", { json: { memberId: members[0]?.id } });
  return { c, members };
}

export async function newBatch(c: ReturnType<typeof client>, source = "web") {
  return ((await (await c.req("/api/batches", { json: { source } })).json()) as { batchId: string }).batchId;
}

export const serve = (app: App) => Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 120 });

export type TusOpts = {
  cookie: string;
  meta: Record<string, string>;
  chunkSize?: number;
  uploadUrl?: string;
  onProgress?: (sent: number, total: number, upload: tus.Upload) => void;
};

/** Sube con tus-js-client (el mismo protocolo que Uppy). Resuelve con la URL de la subida. */
export function tusUpload(endpoint: string, data: Buffer, o: TusOpts) {
  let upload = null as unknown as tus.Upload; // se asigna sincrónicamente dentro del Promise
  const done = new Promise<string>((resolve, reject) => {
    upload = new tus.Upload(data, {
      endpoint,
      uploadUrl: o.uploadUrl,
      chunkSize: o.chunkSize ?? 50 * 1024 * 1024,
      headers: { cookie: o.cookie },
      metadata: o.meta,
      retryDelays: [],
      storeFingerprintForResuming: false,
      onProgress: (sent, total) => o.onProgress?.(sent, total, upload),
      onError: reject,
      onSuccess: () => resolve(upload.url ?? ""),
    });
    upload.start();
  });
  return {
    done,
    get upload() {
      return upload;
    },
  };
}

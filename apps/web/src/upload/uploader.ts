// Motor de subida: prechequeo de duplicados → lote → tus con Uppy. Vive fuera de React para que la
// subida siga aunque se cambie de pantalla.
import {
  API_PREFIX,
  BatchCreated,
  type BatchSource,
  endpoints,
  PrecheckResponse,
  partialHash,
  TusMetadata,
} from "@lfg/shared";
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import type { z } from "zod";
import { api, errorText } from "../api/client";
import { navigate } from "../router";
import { createStore } from "../store";

export type UploadState = {
  phase: "idle" | "preparing" | "uploading" | "done";
  total: number;
  prepared: number;
  done: number;
  skipped: number;
  failed: number;
  bytesTotal: number;
  bytesDone: number;
  batchId: string | null;
  offline: boolean;
  error: string | null;
};

const IDLE: UploadState = {
  phase: "idle",
  total: 0,
  prepared: 0,
  done: 0,
  skipped: 0,
  failed: 0,
  bytesTotal: 0,
  bytesDone: 0,
  batchId: null,
  offline: false,
  error: null,
};

export const upload = createStore<UploadState>(IDLE);
const patch = (p: Partial<UploadState>) => upload.set((s) => ({ ...s, ...p }));

/** OBLIGATORIO (DECISIONES E0): Bun.serve rechaza bodies de más de 128 MB. */
export const CHUNK_SIZE = 50 * 1024 * 1024;
const PRECHECK_CHUNK = 500;
const HASH_CONCURRENCY = 4;

let uppy: Uppy | null = null;
let wakeLock: WakeLockSentinel | null = null;

async function keepAwake() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible")
      wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    // Sin Wake Lock (o batería baja): la subida sigue igual.
  }
}
document.addEventListener("visibilitychange", () => {
  const { phase } = upload.get();
  if (document.visibilityState === "visible" && (phase === "preparing" || phase === "uploading")) keepAwake();
});
window.addEventListener("offline", () => patch({ offline: true }));
window.addEventListener("online", () => {
  patch({ offline: false });
  if (uppy && upload.get().failed > 0) retryFailed();
});

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function startUpload(files: File[], source: z.infer<typeof BatchSource>) {
  if (upload.get().phase === "preparing" || upload.get().phase === "uploading") return;
  upload.set({ ...IDLE, phase: "preparing", total: files.length, offline: !navigator.onLine });
  keepAwake();
  try {
    let prepared = 0;
    const hashes = await mapLimit(files, HASH_CONCURRENCY, async (f) => {
      const h = await partialHash(f);
      patch({ prepared: ++prepared });
      return h;
    });
    const exists: boolean[] = [];
    for (let i = 0; i < files.length; i += PRECHECK_CHUNK) {
      const chunk = files
        .slice(i, i + PRECHECK_CHUNK)
        .map((f, j) => ({ size: f.size, partialHash: hashes[i + j] as string }));
      const res = await api.post(endpoints.precheck, { files: chunk }, PrecheckResponse);
      exists.push(...res.map((r) => r.exists));
    }
    const fresh = files.filter((_, i) => !exists[i]);
    const skipped = files.length - fresh.length;
    if (fresh.length === 0) {
      release();
      return patch({ phase: "done", skipped, total: files.length });
    }
    const { batchId } = await api.post(endpoints.batches, { source }, BatchCreated);
    patch({
      phase: "uploading",
      batchId,
      skipped,
      total: fresh.length,
      bytesTotal: fresh.reduce((n, f) => n + f.size, 0),
    });
    runUppy(fresh, batchId);
  } catch (e) {
    release();
    patch({ phase: "idle", error: errorText(e) });
  }
}

function runUppy(files: File[], batchId: string) {
  uppy?.destroy();
  const u = new Uppy({ autoProceed: false, allowMultipleUploadBatches: true });
  uppy = u;
  u.use(Tus, {
    endpoint: API_PREFIX + endpoints.tus,
    chunkSize: CHUNK_SIZE,
    limit: 3,
    // Reintenta solo por un buen rato si se corta el wifi; al volver la red, retryAll.
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000, 60000, 60000, 60000],
    allowedMetaFields: ["filename", "filetype", "batchId", "lastModified"],
    removeFingerprintOnSuccess: true,
  });
  for (const f of files) {
    const meta = TusMetadata.parse({
      filename: f.name.slice(0, 255),
      filetype: f.type.slice(0, 100),
      batchId,
      lastModified: String(Math.max(0, Math.trunc(f.lastModified))),
    });
    try {
      u.addFile({ name: f.name, type: f.type, data: f, meta: { ...meta, relativePath: f.webkitRelativePath || null } });
    } catch {
      // El mismo archivo elegido dos veces: Uppy lo rechaza, alcanza con subirlo una.
      patch({ total: upload.get().total - 1 });
    }
  }
  const sent = new Map<string, number>();
  u.on("upload-progress", (file, p) => {
    if (!file) return;
    sent.set(file.id, p.bytesUploaded);
    let sum = 0;
    for (const v of sent.values()) sum += v;
    patch({ bytesDone: sum });
  });
  u.on("upload-success", () => patch({ done: upload.get().done + 1 }));
  u.on("complete", (r) => {
    const failed = r.failed?.length ?? 0;
    patch({ failed, phase: failed ? "uploading" : "done" });
    if (!failed) {
      release();
      const path = window.location.pathname;
      if (path === "/subir" || path === "/compartir") navigate(`/lote/${batchId}`, true);
    }
  });
  u.upload().catch((e) => patch({ error: errorText(e) }));
}

export function retryFailed() {
  if (!uppy) return;
  patch({ failed: 0, error: null });
  keepAwake();
  uppy.retryAll().catch((e) => patch({ error: errorText(e) }));
}

function release() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

export function resetUpload() {
  if (upload.get().phase === "uploading" || upload.get().phase === "preparing") return;
  upload.set(IDLE);
}

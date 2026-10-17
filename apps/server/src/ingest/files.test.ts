import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { fileUrl, originalUrl } from "@lfg/shared";
import { derivativeRelPath, fastVolume } from "../storage";
import { FIXTURES } from "../test-utils";
import { CAST_TTL_S, signFileUrl } from "./files";
import { finalizeUpload } from "./finalize";
import { makeEnv, newBatch, serve, setupGallery } from "./testkit";

const servers: { stop: (force?: boolean) => void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

async function env() {
  const e = await makeEnv();
  const { c } = await setupGallery(e.app);
  const server = serve(e.app);
  servers.push(server);
  const batchId = await newBatch(c);
  const tmpPath = join(e.dir, "up.tmp");
  const original = await Bun.file(join(FIXTURES, "foto-gps.jpg")).arrayBuffer();
  await Bun.write(tmpPath, original);
  const { mediaId } = await finalizeUpload(e.ctx, { tmpPath, batchId, name: "Foto de ejemplo ñ.jpg" });
  const sha =
    e.db.query<{ sha256: string }, [string]>("SELECT sha256 FROM media WHERE id = ?").get(mediaId)?.sha256 ?? "";
  // Un derivado "thumb" a mano (lo produce el worker).
  const fast = fastVolume(e.db);
  const rel = derivativeRelPath(sha, "thumb");
  await Bun.write(join(fast.path, rel), "miniatura-webp-de-prueba");
  e.db
    .query(
      "INSERT INTO derivatives (media_id, variant, volume_id, path, mime, width, height, bytes) VALUES (?, 'thumb', ?, ?, 'image/webp', 400, 300, 24)",
    )
    .run(mediaId, fast.id, rel);
  const secret = JSON.parse(
    e.db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'cast_secret'").get()?.value ?? "",
  ) as string;
  return { ...e, c, base: server.url.origin, sha, mediaId, original: new Uint8Array(original), secret };
}

test("/files: Range, HEAD con Content-Length real, Content-Disposition y caché", async () => {
  const { c, base, sha, original } = await env();
  const headers = { cookie: c.cookie };

  const full = await fetch(base + originalUrl(sha), { headers });
  expect(full.status).toBe(200);
  expect(full.headers.get("accept-ranges")).toBe("bytes");
  expect(full.headers.get("content-type")).toBe("image/jpeg");
  expect(full.headers.get("content-disposition")).toBe(
    `attachment; filename*=UTF-8''${encodeURIComponent("Foto de ejemplo ñ.jpg")}`,
  );
  expect(new Uint8Array(await full.arrayBuffer())).toEqual(original);

  const part = await fetch(base + originalUrl(sha), { headers: { ...headers, range: "bytes=10-19" } });
  expect(part.status).toBe(206);
  expect(part.headers.get("content-range")).toBe(`bytes 10-19/${original.length}`);
  expect(new Uint8Array(await part.arrayBuffer())).toEqual(original.slice(10, 20));
  const suffix = await fetch(base + originalUrl(sha), { headers: { ...headers, range: "bytes=-5" } });
  expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(original.slice(-5));

  const head = await fetch(base + originalUrl(sha), { method: "HEAD", headers });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe(String(original.length));

  const thumb = await fetch(base + fileUrl(sha, "thumb"), { headers });
  expect(thumb.status).toBe(200);
  expect(thumb.headers.get("content-type")).toBe("image/webp");
  expect(thumb.headers.get("content-disposition")).toBe("inline");
  expect(thumb.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  expect(await thumb.text()).toBe("miniatura-webp-de-prueba");

  expect((await fetch(base + fileUrl(sha, "preview"), { headers })).status).toBe(404);
  expect((await fetch(`${base}/api/files/${sha}/thumb.mp4`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/api/files/nada/original`, { headers })).status).toBe(404);
  expect((await fetch(base + originalUrl(sha))).status).toBe(401);
});

test("firma de cast: válida, vencida y alterada", async () => {
  const { base, sha, secret } = await env();
  const exp = Math.floor(Date.now() / 1000) + 60;
  expect((await fetch(base + signFileUrl(secret, sha, "thumb", exp))).status).toBe(200);
  expect((await fetch(base + signFileUrl(secret, sha, "original", exp))).status).toBe(200);
  // Vencida.
  expect((await fetch(base + signFileUrl(secret, sha, "thumb", Math.floor(Date.now() / 1000) - 1))).status).toBe(401);
  // Alterada: otra variante con la firma de thumb, otro vencimiento, otra clave.
  const sig = signFileUrl(secret, sha, "thumb", exp).split("sig=")[1];
  expect((await fetch(`${base}${originalUrl(sha)}?exp=${exp}&sig=${sig}`)).status).toBe(401);
  expect((await fetch(`${base}${fileUrl(sha, "thumb")}?exp=${exp + 1}&sig=${sig}`)).status).toBe(401);
  expect((await fetch(base + signFileUrl("f".repeat(64), sha, "thumb", exp))).status).toBe(401);
  expect((await fetch(`${base}${fileUrl(sha, "thumb")}?exp=${exp}&sig=zz`)).status).toBe(401);
});

test("POST /cast/sign: URLs absolutas (con X-Forwarded-*) y vencimiento de 6 h", async () => {
  const { c, base, mediaId, sha } = await env();
  const res = await fetch(`${base}/api/cast/sign`, {
    method: "POST",
    headers: {
      cookie: c.cookie,
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "galeria.ejemplo",
    },
    body: JSON.stringify({ mediaIds: [mediaId, "nada"] }),
  });
  const { items } = (await res.json()) as {
    items: { mediaId: string; url: string; contentType: string; posterUrl: string | null }[];
  };
  expect(items).toHaveLength(1);
  const [it] = items;
  // Sin versión mediana todavía: el original. Poster: la miniatura.
  expect(it?.url.startsWith(`https://galeria.ejemplo${originalUrl(sha)}?exp=`)).toBe(true);
  expect(it?.contentType).toBe("image/jpeg");
  expect(it?.posterUrl?.startsWith(`https://galeria.ejemplo${fileUrl(sha, "thumb")}?exp=`)).toBe(true);
  const exp = Number(new URL(it?.url ?? "").searchParams.get("exp"));
  expect(Math.abs(exp - (Date.now() / 1000 + CAST_TTL_S))).toBeLessThan(5);
  // La URL firmada anda sin cookie.
  const path = new URL(it?.url ?? "");
  expect((await fetch(base + path.pathname + path.search)).status).toBe(200);
});

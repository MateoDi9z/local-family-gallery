import { expect, test } from "bun:test";
import { join } from "node:path";
import { FIXTURES } from "../test-utils";
import { makeEnv, setupGallery } from "./testkit";

const form = async (...names: string[]) => {
  const fd = new FormData();
  for (const n of names) fd.append("file", Bun.file(join(FIXTURES, n.split(":")[0] as string)), n.split(":")[1] ?? n);
  return fd;
};

test("Atajo: sin nombre o con la extensión equivocada, el formato sale del contenido", async () => {
  const { app, db } = await makeEnv();
  const { c, members } = await setupGallery(app);
  const created = await c.req("/api/shortcut/tokens", { json: { memberId: members[0]?.id, label: "iPhone" } });
  const { token } = (await created.json()) as { token: string };
  const res = await app.request("/api/shortcut/upload", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: await form("foto-gps.jpg:file", "foto-rotada.heic:", "foto-sin-gps.jpg:IMG_0003.HEIC", "video-hdr.mov:video"),
  });
  expect(res.status).toBe(200);
  const rows = db
    .query<{ original_name: string; mime: string; kind: string; original_path: string }, []>(
      "SELECT original_name, mime, kind, original_path FROM media ORDER BY rowid",
    )
    .all();
  expect(rows.map((r) => [r.original_name, r.mime, r.kind])).toEqual([
    ["file.jpg", "image/jpeg", "photo"],
    ["archivo.heic", "image/heic", "photo"],
    ["IMG_0003.jpg", "image/jpeg", "photo"],
    ["video.mov", "video/quicktime", "video"],
  ]);
  expect(rows.map((r) => r.original_path.split(".").at(-1))).toEqual(["jpg", "heic", "jpg", "mov"]);

  // Como lo manda iOS a veces: la parte sin `filename` (formData() la volvería texto y rompería los bytes).
  const jpg = new Uint8Array(await Bun.file(join(FIXTURES, "foto-parecida.jpg")).arrayBuffer());
  const enc = new TextEncoder();
  const raw = new Blob([
    enc.encode('--b0\r\nContent-Disposition: form-data; name="file"\r\nContent-Type: image/jpeg\r\n\r\n'),
    jpg,
    enc.encode("\r\n--b0--\r\n"),
  ]);
  const sinNombre = await app.request("/api/shortcut/upload", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "multipart/form-data; boundary=b0" },
    body: raw,
  });
  expect(sinNombre.status).toBe(200);
  const last = db
    .query<{ original_name: string; size_bytes: number; sha256: string }, []>(
      "SELECT original_name, size_bytes, sha256 FROM media ORDER BY rowid DESC LIMIT 1",
    )
    .get();
  expect(last).toEqual({
    original_name: "archivo.jpg",
    size_bytes: jpg.length,
    sha256: new Bun.CryptoHasher("sha256").update(jpg).digest("hex"),
  });
});

test("Atajo: token válido sube varios archivos en un lote; revocado → 401", async () => {
  const { app, db } = await makeEnv();
  const { c, members } = await setupGallery(app);
  const p2 = members[1]?.id as string;

  const created = await c.req("/api/shortcut/tokens", { json: { memberId: p2, label: "iPhone" } });
  expect(created.status).toBe(201);
  const tok = (await created.json()) as { id: string; token: string; memberId: string; revoked: boolean };
  expect(tok).toMatchObject({ memberId: p2, revoked: false });
  expect(db.query<{ token_hash: string }, []>("SELECT token_hash FROM api_tokens").get()?.token_hash).not.toBe(
    tok.token,
  );
  const list = (await (await c.req("/api/shortcut/tokens")).json()) as Record<string, unknown>[];
  expect(list).toHaveLength(1);
  expect(list[0]?.token).toBeUndefined();

  const auth = { authorization: `Bearer ${tok.token}` };
  const res = await app.request("/api/shortcut/upload", {
    method: "POST",
    headers: auth,
    body: await form(
      "foto-gps.jpg:IMG_0001.JPG",
      "video-hdr.mov:IMG_0002.MOV",
      "foto-gps.jpg:repetida.jpg",
      "manifest.json",
    ),
  });
  expect(res.status).toBe(200);
  const up = (await res.json()) as { batchId: string; items: { name: string; mediaId: string; duplicate: boolean }[] };
  expect(up.items.map((i) => [i.name, i.duplicate])).toEqual([
    ["IMG_0001.JPG", false],
    ["IMG_0002.MOV", false],
    ["repetida.jpg", true],
  ]);
  expect(up.items[2]?.mediaId).toBe(up.items[0]?.mediaId as string);
  expect(db.query("SELECT member_id, source, device_id FROM batches WHERE id = ?").get(up.batchId)).toEqual({
    member_id: p2,
    source: "shortcut",
    device_id: null,
  });
  expect(db.query("SELECT count(*) AS n FROM media WHERE member_id = ?").get(p2)).toEqual({ n: 2 });
  expect(db.query("SELECT count(*) AS n FROM jobs WHERE type = 'extract_metadata'").get()).toEqual({ n: 2 });

  // Sin archivos soportados / sin archivos.
  const txt = await app.request("/api/shortcut/upload", {
    method: "POST",
    headers: auth,
    body: await form("manifest.json"),
  });
  expect(txt.status).toBe(415);
  expect(
    (await app.request("/api/shortcut/upload", { method: "POST", headers: auth, body: new FormData() })).status,
  ).toBe(400);

  expect((await c.req(`/api/shortcut/tokens/${tok.id}`, { method: "DELETE" })).status).toBe(204);
  const revoked = await app.request("/api/shortcut/upload", {
    method: "POST",
    headers: auth,
    body: await form("foto-sin-gps.jpg"),
  });
  expect(revoked.status).toBe(401);
  expect((await revoked.json()).error).toBe("token_invalid");
  expect(
    (
      await app.request("/api/shortcut/upload", {
        method: "POST",
        headers: { authorization: "Bearer otro" },
        body: await form("foto-sin-gps.jpg"),
      })
    ).status,
  ).toBe(401);
  expect((await (await c.req("/api/shortcut/tokens")).json())[0]?.revoked).toBe(true);
});

test("Atajo de a una: las que llegan seguidas van al mismo lote; después de un rato, a otro", async () => {
  const { app, db } = await makeEnv();
  const { c, members } = await setupGallery(app);
  const created = await c.req("/api/shortcut/tokens", { json: { memberId: members[0]?.id, label: "iPhone" } });
  const { token } = (await created.json()) as { token: string };
  const send = async (fixture: string) => {
    const res = await app.request("/api/shortcut/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: await form(fixture),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { batchId: string }).batchId;
  };
  const first = await send("foto-gps.jpg");
  expect(await send("foto-sin-gps.jpg")).toBe(first);
  // Una hora sin mandar nada: lo próximo es otro lote.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  db.query("UPDATE batch_items SET created_at = ?").run(hourAgo);
  db.query("UPDATE batches SET created_at = ?").run(hourAgo);
  expect(await send("captura.png")).not.toBe(first);
  expect(db.query("SELECT count(*) AS n FROM batches WHERE source = 'shortcut'").get()).toEqual({ n: 2 });
});

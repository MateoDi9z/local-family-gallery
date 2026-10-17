import { expect, test } from "bun:test";
import type { Member } from "@lfg/shared";
import { client, makeEnv, SETUP, setupGallery } from "./testkit";

test("asistente, cookie de dispositivo, 409 antes del setup y 401 sin PIN", async () => {
  const { app, db } = await makeEnv();
  const c = client(app);
  expect(await (await c.req("/api/setup/status")).json()).toEqual({ setupDone: false });
  const pre = await c.req("/api/me");
  expect(pre.status).toBe(409);
  expect((await pre.json()).error).toBe("setup_required");
  expect((await c.req("/api/auth/pin", { json: { pin: "1234" } })).status).toBe(409);

  expect((await c.req("/api/setup", { json: { ...SETUP, pin: "12" } })).status).toBe(400);
  const res = await c.req("/api/setup", { json: SETUP });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=Lax");
  expect(setCookie).toContain("Path=/");
  // Quien hizo el asistente ya está adentro.
  expect((await c.req("/api/me")).status).toBe(200);
  expect((await c.req("/api/setup", { json: SETUP })).status).toBe(409);
  expect(await (await c.req("/api/setup/status")).json()).toEqual({ setupDone: true });

  // En la base: hash del PIN, secreto de cast y solo el SHA-256 del token.
  const pinHash = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'pin_hash'").get();
  expect(pinHash?.value).not.toContain("1234");
  const secret = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'cast_secret'").get();
  expect(JSON.parse(secret?.value ?? "")).toMatch(/^[0-9a-f]{64}$/);
  const token = c.cookie.split("=")[1] ?? "";
  const dev = db.query<{ session_hash: string }, []>("SELECT session_hash FROM devices").get();
  expect(dev?.session_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(dev?.session_hash).not.toBe(token);

  const other = client(app);
  const r401 = await other.req("/api/me");
  expect(r401.status).toBe(401);
  expect((await r401.json()).error).toBe("pin_required");
  expect((await other.req("/api/auth/pin", { json: { pin: "9999" } })).status).toBe(401);
  const ok = await other.req("/api/auth/pin", { json: { pin: "1234" } });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ member: null });
  expect((await other.req("/api/me")).status).toBe(200);
});

test("miembros: elegir, crear, archivar (nunca borrar) y no elegir archivados", async () => {
  const { app } = await makeEnv();
  const { c, members } = await setupGallery(app);
  expect(members.map((m) => m.name)).toEqual(["Persona 1", "Persona 2"]);
  expect((await (await c.req("/api/me")).json()).member.name).toBe("Persona 1");

  const created = (await (
    await c.req("/api/members", { json: { name: "Persona 3", color: "#123456" } })
  ).json()) as Member;
  expect(created).toMatchObject({ name: "Persona 3", archived: false });
  const patched = await c.req(`/api/members/${created.id}`, { method: "PATCH", json: { archived: true } });
  expect(await patched.json()).toMatchObject({ name: "Persona 3", archived: true });
  expect(((await (await c.req("/api/members")).json()) as Member[]).length).toBe(3);
  expect((await c.req("/api/me/member", { json: { memberId: created.id } })).status).toBe(400);
  expect((await c.req("/api/members/nada", { method: "PATCH", json: { name: "X" } })).status).toBe(404);
});

test("ajustes: cambiar el PIN no saca a los dispositivos que ya entraron", async () => {
  const { app } = await makeEnv();
  const { c } = await setupGallery(app);
  expect(await (await c.req("/api/settings")).json()).toEqual({ galleryName: SETUP.galleryName, home: SETUP.home });
  const res = await c.req("/api/settings", { method: "PATCH", json: { galleryName: "Otra", pin: "5678" } });
  expect(await res.json()).toEqual({ galleryName: "Otra", home: SETUP.home });
  expect((await c.req("/api/me")).status).toBe(200);
  const other = client(app);
  expect((await other.req("/api/auth/pin", { json: { pin: "1234" } })).status).toBe(401);
  expect((await other.req("/api/auth/pin", { json: { pin: "5678" } })).status).toBe(200);
});

test("rate limit del PIN: 10 errores por IP en 10 minutos → 429", async () => {
  const { app } = await makeEnv();
  await setupGallery(app);
  const c = client(app);
  const ip = { "x-forwarded-for": "192.0.2.10" };
  for (let i = 0; i < 10; i++)
    expect((await c.req("/api/auth/pin", { json: { pin: "0000" }, headers: ip })).status).toBe(401);
  const blocked = await c.req("/api/auth/pin", { json: { pin: "1234" }, headers: ip });
  expect(blocked.status).toBe(429);
  expect((await blocked.json()).message).toContain("Esperá");
  // Otra IP no está bloqueada.
  expect(
    (await c.req("/api/auth/pin", { json: { pin: "1234" }, headers: { "x-forwarded-for": "192.0.2.11" } })).status,
  ).toBe(200);
});

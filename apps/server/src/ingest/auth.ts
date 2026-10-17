// Asistente de primer uso, PIN, sesión por dispositivo, miembros y ajustes.
import type { Database } from "bun:sqlite";
import {
  API_PREFIX,
  AuthPinRequest,
  DEVICE_COOKIE,
  endpoints,
  type Member,
  MemberInput,
  MemberPatch,
  SetMemberRequest,
  SettingsPatch,
  SetupRequest,
} from "@lfg/shared";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { matchedRoutes } from "hono/route";
import { ulid } from "ulid";
import type { AppEnv, Ctx } from "../context";
import { getSetting, setSetting } from "../db";
import { body, clientIp, fail, randomToken, sha256Hex } from "./common";

// Los navegadores topean la cookie en 400 días (y Hono no deja más): se renueva con el uso.
const COOKIE_MAX_AGE = 400 * 24 * 3600;
const PIN_MAX_FAILS = 10;
const PIN_WINDOW_MS = 10 * 60 * 1000;

export const isSetupDone = (db: Database) => getSetting<boolean>(db, "setup_done") === true;

type MemberRow = { id: string; name: string; color: string; archived_at: string | null };
const toMember = (r: MemberRow): Member => ({
  id: r.id,
  name: r.name,
  color: r.color,
  archived: r.archived_at !== null,
});

export function getMember(db: Database, id: string | null): MemberRow | null {
  if (!id) return null;
  return db.query<MemberRow, [string]>("SELECT id, name, color, archived_at FROM members WHERE id = ?").get(id);
}

function setDeviceCookie(c: Context, token: string) {
  setCookie(c, DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Crea un dispositivo, guarda solo el SHA-256 del token y deja la cookie puesta. */
function createDevice(c: Context<AppEnv>, db: Database): string {
  const token = randomToken();
  const id = ulid();
  const now = new Date().toISOString();
  db.query(
    "INSERT INTO devices (id, member_id, session_hash, user_agent, created_at, last_seen_at) VALUES (?, NULL, ?, ?, ?, ?)",
  ).run(id, sha256Hex(token), c.req.header("user-agent")?.slice(0, 200) ?? null, now, now);
  setDeviceCookie(c, token);
  c.set("deviceId", id);
  c.set("memberId", null);
  return id;
}

/**
 * Pone `deviceId`/`memberId` desde la cookie. Públicas: /setup/status, /setup, /auth/pin,
 * /shortcut/upload (Bearer) y /files/* (cookie o firma de cast, lo valida la ruta).
 */
export function authMiddleware(ctx: Ctx): MiddlewareHandler<AppEnv> {
  const { db } = ctx;
  const findDevice = db.query<{ id: string; member_id: string | null; last_seen_at: string }, [string]>(
    "SELECT id, member_id, last_seen_at FROM devices WHERE session_hash = ?",
  );
  return async (c, next) => {
    const path = c.req.path.slice(API_PREFIX.length);
    const token = getCookie(c, DEVICE_COOKIE);
    const device = token ? findDevice.get(sha256Hex(token)) : null;
    if (token && device) {
      c.set("deviceId", device.id);
      c.set("memberId", device.member_id);
      if (Date.now() - Date.parse(device.last_seen_at) > 60_000) {
        db.query("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), device.id);
        setDeviceCookie(c, token);
      }
    }
    // Ruta inexistente (solo matchean los middlewares y el catch-all de la web): que siga al 404.
    if (!matchedRoutes(c).some((r) => r.path !== "/*" && r.path !== `${API_PREFIX}/*`)) return next();
    if (path === endpoints.setupStatus || path === endpoints.setup) return next();
    if (!isSetupDone(db)) fail(409, "setup_required", "Primero hay que terminar la configuración inicial.");
    if (path === endpoints.authPin || path === endpoints.shortcutUpload || path.startsWith("/files/")) return next();
    if (!c.get("deviceId")) fail(401, "pin_required", "Ingresá el PIN familiar para entrar.");
    return next();
  };
}

export function authRoutes(ctx: Ctx) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();
  // ponytail: rate limit en memoria por proceso; alcanza para una sola instancia de la api.
  const pinFails = new Map<string, number[]>();

  const me = (c: Context<AppEnv>) => {
    const m = getMember(db, c.get("memberId"));
    return { device: { id: c.get("deviceId") as string }, member: m ? toMember(m) : null };
  };

  r.get(endpoints.setupStatus, (c) => c.json({ setupDone: isSetupDone(db) }));

  r.post(endpoints.setup, async (c) => {
    if (isSetupDone(db)) fail(409, "setup_done", "La galería ya está configurada.");
    const b = await body(c, SetupRequest);
    const pinHash = await Bun.password.hash(b.pin);
    const now = new Date().toISOString();
    db.transaction(() => {
      // Dos asistentes a la vez: el segundo frena acá.
      if (isSetupDone(db)) fail(409, "setup_done", "La galería ya está configurada.");
      setSetting(db, "gallery_name", b.galleryName);
      setSetting(db, "home", b.home);
      setSetting(db, "pin_hash", pinHash);
      setSetting(db, "cast_secret", Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"));
      const ins = db.query("INSERT INTO members (id, name, color, created_at) VALUES (?, ?, ?, ?)");
      for (const m of b.members) ins.run(ulid(), m.name, m.color, now);
      setSetting(db, "setup_done", true);
    }).immediate();
    // Quien hizo el asistente queda adentro sin volver a poner el PIN.
    createDevice(c, db);
    return c.json({ setupDone: true }, 201);
  });

  r.post(endpoints.authPin, async (c) => {
    const ip = clientIp(c);
    const now = Date.now();
    const fails = (pinFails.get(ip) ?? []).filter((t) => now - t < PIN_WINDOW_MS);
    if (fails.length >= PIN_MAX_FAILS)
      fail(429, "too_many_attempts", "Probaste muchas veces. Esperá unos minutos y volvé a intentar.");
    const { pin } = await body(c, AuthPinRequest);
    const hash = getSetting<string>(db, "pin_hash");
    if (!hash || !(await Bun.password.verify(pin, hash))) {
      pinFails.set(ip, [...fails, now]);
      fail(401, "wrong_pin", "Ese PIN no es. Probá de nuevo.");
    }
    pinFails.delete(ip);
    createDevice(c, db);
    return c.json(me(c));
  });

  r.get(endpoints.me, (c) => c.json(me(c)));

  r.post(endpoints.meMember, async (c) => {
    const { memberId } = await body(c, SetMemberRequest);
    const m = getMember(db, memberId);
    if (!m || m.archived_at) fail(400, "member_invalid", "Esa persona no está en la galería. Elegí otra.");
    db.query("UPDATE devices SET member_id = ? WHERE id = ?").run(memberId, c.get("deviceId"));
    c.set("memberId", memberId);
    return c.json(me(c));
  });

  r.get(endpoints.members, (c) =>
    c.json(
      db
        .query<MemberRow, []>("SELECT id, name, color, archived_at FROM members ORDER BY created_at, rowid")
        .all()
        .map(toMember),
    ),
  );

  r.post(endpoints.members, async (c) => {
    const b = await body(c, MemberInput);
    const id = ulid();
    db.query("INSERT INTO members (id, name, color, created_at) VALUES (?, ?, ?, ?)").run(
      id,
      b.name,
      b.color,
      new Date().toISOString(),
    );
    return c.json(toMember(getMember(db, id) as MemberRow), 201);
  });

  r.patch(`${endpoints.members}/:id`, async (c) => {
    const id = c.req.param("id");
    const b = await body(c, MemberPatch);
    const cur = getMember(db, id);
    if (!cur) fail(404, "not_found", "No encontramos a esa persona.");
    // Archivar, nunca borrar: sus fotos siguen siendo suyas.
    const archivedAt =
      b.archived === undefined ? cur.archived_at : b.archived ? (cur.archived_at ?? new Date().toISOString()) : null;
    db.query("UPDATE members SET name = ?, color = ?, archived_at = ? WHERE id = ?").run(
      b.name ?? cur.name,
      b.color ?? cur.color,
      archivedAt,
      id,
    );
    return c.json(toMember(getMember(db, id) as MemberRow));
  });

  const settings = () => ({
    galleryName: getSetting<string>(db, "gallery_name") ?? "",
    home: getSetting<{ lat: number; lon: number }>(db, "home") ?? { lat: 0, lon: 0 },
  });

  r.get(endpoints.settings, (c) => c.json(settings()));

  r.patch(endpoints.settings, async (c) => {
    const b = await body(c, SettingsPatch);
    // Cambiar el PIN no saca a los dispositivos que ya entraron.
    const pinHash = b.pin ? await Bun.password.hash(b.pin) : null;
    db.transaction(() => {
      if (b.galleryName) setSetting(db, "gallery_name", b.galleryName);
      if (b.home) setSetting(db, "home", b.home);
      if (pinHash) setSetting(db, "pin_hash", pinHash);
    })();
    return c.json(settings());
  });

  return r;
}

// Mock de la API para desarrollar el frontend sin el backend. Implementa los contratos de
// @lfg/shared (valida lo que entra y lo que sale), guarda todo en memoria, sirve miniaturas SVG
// y un subconjunto de tus (POST, HEAD, PATCH). Solo datos genéricos ("Persona 1", "Ciudad de ejemplo").
// Uso: bun mock/server.ts [--port 3000] [--dist dist]
import { join, normalize } from "node:path";
import * as S from "@lfg/shared";
import { API_PREFIX, DEVICE_COOKIE, endpoints as E, originalUrl, partialHash } from "@lfg/shared";
import type { z } from "zod";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PORT = Number(arg("port") ?? process.env.MOCK_PORT ?? 3000);
const DIST = arg("dist");
const PROCESS_MS = Number(process.env.MOCK_PROCESS_MS ?? 1200);

type Media = S.MediaItem & { bytes: Uint8Array | null; mime: string; partialHash: string; batchId: string | null };
type PlaceRow = { id: string; name: string; admin1: string | null; countryCode: string; lat: number; lon: number };
type TripRow = {
  id: string;
  name: string;
  nameIsCustom: boolean;
  placeId: string;
  merged?: boolean;
  memberIds?: string[];
};

const PLACES: PlaceRow[] = [
  { id: "pl1", name: "Ciudad de ejemplo 1", admin1: "Región de ejemplo", countryCode: "XA", lat: 48.86, lon: 2.29 },
  { id: "pl2", name: "Ciudad de ejemplo 2", admin1: "Región de ejemplo", countryCode: "XB", lat: 41.89, lon: 12.49 },
  { id: "pl3", name: "Ciudad de ejemplo 3", admin1: null, countryCode: "XC", lat: 40.69, lon: -74.04 },
  { id: "pl4", name: "Ciudad de ejemplo 4", admin1: null, countryCode: "XD", lat: -33.86, lon: 151.21 },
];

function fresh() {
  return {
    setupDone: false,
    galleryName: "",
    home: { lat: 0, lon: 0 },
    pin: "",
    members: [] as S.Member[],
    devices: new Map<string, { authed: boolean; memberId: string | null }>(),
    media: [] as Media[],
    places: [...PLACES] as PlaceRow[],
    trips: new Map<string, TripRow>(),
    batches: new Map<
      string,
      {
        memberId: string | null;
        mediaIds: string[];
        duplicates: number;
        source: z.infer<typeof S.BatchSource>;
        createdAt: string;
      }
    >(),
    uploads: new Map<string, { length: number; parts: Uint8Array[]; offset: number; meta: Record<string, string> }>(),
    similar: [] as { id: string; a: string; b: string; status: string }[],
    tokens: [] as z.infer<typeof S.ShortcutToken>[],
  };
}
let db = fresh();
let seq = 0;
const id = (p: string) => `${p}${(++seq).toString(36).padStart(6, "0")}`;
const listeners = new Set<(data: string) => void>();
const emit = (ev: S.ServerEvent) => {
  for (const l of listeners) l(JSON.stringify(ev));
};

// ── Respuestas ─────────────────────────────────────────────────────
const json = <T extends z.ZodType>(schema: T, data: z.input<T>, status = 200, headers: Record<string, string> = {}) =>
  Response.json(schema.parse(data), { status, headers });
const fail = (status: number, error: string, message: string) => Response.json({ error, message }, { status });
const noContent = () => new Response(null, { status: 204 });

function cookieOf(req: Request) {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`${DEVICE_COOKIE}=([^;]+)`));
  return m?.[1] ?? null;
}
const setCookie = (v: string) => `${DEVICE_COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=315360000`;

// ── Miniaturas SVG ─────────────────────────────────────────────────
function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
function thumbSvg(sha: string, label: string) {
  const h = hue(sha);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 70% 75%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 60% 55%)"/></linearGradient></defs>
<rect width="400" height="400" fill="url(#s)"/><circle cx="300" cy="100" r="44" fill="hsl(45 95% 70%)"/>
<path d="M0 330 L120 180 L210 280 L280 210 L400 340 L400 400 L0 400Z" fill="hsl(${(h + 180) % 360} 35% 35%)"/>
<text x="20" y="385" font-family="sans-serif" font-size="26" fill="#fff">${label.replace(/[<&>"]/g, "")}</text></svg>`;
}

// ── Serializar ─────────────────────────────────────────────────────
const pub = (m: Media): S.MediaItem => {
  const { bytes: _b, mime: _m, partialHash: _p, batchId: _bi, ...rest } = m;
  return rest;
};
const ready = () => db.media.filter((m) => m.status === "ready");
function placeOut(p: PlaceRow): S.Place {
  const items = ready().filter((m) => m.placeId === p.id);
  return { ...p, count: items.length, coverThumbUrl: items[0]?.thumbUrl ?? null };
}
function tripOut(t: TripRow): S.Trip {
  const items = ready()
    .filter((m) => m.tripId === t.id)
    .sort((a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? ""));
  return {
    id: t.id,
    name: t.name,
    nameIsCustom: t.nameIsCustom,
    startAt: items[0]?.takenAt ?? new Date().toISOString(),
    endAt: items.at(-1)?.takenAt ?? new Date().toISOString(),
    count: items.length,
    coverThumbUrl: items[0]?.thumbUrl ?? null,
    merged: t.merged ?? false,
    memberIds: t.memberIds ?? [...new Set(items.map((m) => m.memberId))],
    membersCustom: !!t.memberIds,
  };
}

function nearestPlace(lat: number, lon: number) {
  let best = db.places[0] as PlaceRow;
  let bd = Number.POSITIVE_INFINITY;
  for (const p of db.places) {
    const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (bd > 9) {
    best = {
      id: id("pl"),
      name: `Ciudad de ejemplo ${db.places.length + 1}`,
      admin1: null,
      countryCode: "XZ",
      lat,
      lon,
    };
    db.places.push(best);
  }
  return best;
}
function tripFor(place: PlaceRow, takenAt: string) {
  const d = new Date(takenAt);
  const key = `${place.id}-${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  let t = db.trips.get(key);
  if (!t) {
    const month = d.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
    t = { id: id("tr"), name: `${place.name}, ${month}`, nameIsCustom: false, placeId: place.id };
    db.trips.set(key, t);
  }
  return t.id;
}
function locate(m: Media, lat: number, lon: number, source: S.MediaItem["locationSource"]) {
  const p = nearestPlace(lat, lon);
  Object.assign(m, {
    lat,
    lon,
    locationSource: source,
    locationConfirmed: source !== "suggested",
    placeId: p.id,
    tripId: tripFor(p, m.takenAt ?? new Date().toISOString()),
  });
}

function makeMedia(o: {
  name: string;
  mime: string;
  bytes: Uint8Array | null;
  sha: string;
  partialHash: string;
  memberId: string;
  batchId: string | null;
  takenAt: string;
}): Media {
  const kind = o.mime.startsWith("video/") || /\.(mov|mp4|m4v)$/i.test(o.name) ? "video" : "photo";
  return {
    id: id("md"),
    kind,
    sha256: o.sha,
    originalName: o.name,
    memberId: o.memberId,
    takenAt: o.takenAt,
    takenTz: null,
    width: 400,
    height: 400,
    durationMs: kind === "video" ? 3000 : null,
    lat: null,
    lon: null,
    locationSource: null,
    locationConfirmed: false,
    placeId: null,
    tripId: null,
    status: "processing",
    favorite: false,
    thumbUrl: null,
    previewUrl: null,
    posterUrl: null,
    videoUrl: null,
    originalUrl: originalUrl(o.sha),
    bytes: o.bytes,
    mime: o.mime,
    partialHash: o.partialHash,
    batchId: o.batchId,
  };
}
function finishProcessing(m: Media) {
  const base = `${API_PREFIX}/files/${m.sha256}`;
  m.status = "ready";
  m.thumbUrl = `${base}/thumb.webp`;
  if (m.kind === "photo") m.previewUrl = `${base}/preview.webp`;
  else {
    m.posterUrl = `${base}/poster.webp`;
    m.videoUrl = `${base}/video.mp4`;
  }
  emit({ type: "media", mediaId: m.id, status: "ready", step: "thumb" });
}

// "GPS" del mock: los fixtures sin GPS en el nombre quedan sin ubicación; el resto va a un lugar fijo.
function fakeGps(name: string): [number, number] | null {
  if (/sin-gps|captura/i.test(name)) return null;
  const p = PLACES[hue(name.replace(/-parecida/, "-gps")) % 2] as PlaceRow;
  return [p.lat + 0.01, p.lon + 0.01];
}

async function finalizeUpload(u: { parts: Uint8Array[]; meta: Record<string, string> }, deviceMember: string | null) {
  const meta = S.TusMetadata.parse(u.meta);
  const bytes = new Uint8Array(await new Blob(u.parts as BlobPart[]).arrayBuffer());
  const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const batch = db.batches.get(meta.batchId);
  if (!batch) return;
  const existing = db.media.find((m) => m.sha256 === sha);
  if (existing) {
    batch.duplicates++;
    return;
  }
  const m = makeMedia({
    name: meta.filename,
    mime: meta.filetype,
    bytes,
    sha,
    partialHash: await partialHash(new Blob([bytes])),
    memberId: batch.memberId ?? deviceMember ?? (db.members[0]?.id as string),
    batchId: meta.batchId,
    takenAt: new Date(meta.lastModified ? Number(meta.lastModified) : Date.now()).toISOString(),
  });
  db.media.push(m);
  batch.mediaIds.push(m.id);
  setTimeout(() => {
    const gps = fakeGps(m.originalName);
    if (gps) locate(m, gps[0], gps[1], "gps");
    if (/parecida/.test(m.originalName)) {
      const twin = db.media.find((x) => x !== m && /foto-gps/.test(x.originalName));
      if (twin) db.similar.push({ id: id("sp"), a: twin.id, b: m.id, status: "pending" });
    }
    finishProcessing(m);
  }, PROCESS_MS);
}

function suggestionFor(m: Media): S.LocationSuggestion | null {
  const other = db.media.find((x) => x.batchId === m.batchId && x.lat !== null && x !== m);
  if (!other || other.lat === null || other.lon === null) return null;
  const place = db.places.find((p) => p.id === other.placeId);
  return { lat: other.lat, lon: other.lon, placeName: place?.name ?? null, fromMediaId: other.id, confidence: 0.8 };
}

// ── Seed para pruebas de rendimiento ───────────────────────────────
function seed(count: number) {
  const memberIds = db.members.map((m) => m.id);
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const sha = new Bun.CryptoHasher("sha256").update(`seed-${seq}-${i}`).digest("hex");
    const years = (i % 3) + 1;
    // Algunas "de hoy hace X años" para la portada.
    const takenAt =
      i < 6 ? new Date(now - years * 365.25 * 864e5).toISOString() : new Date(now - i * 36e5).toISOString();
    const m = makeMedia({
      name: `ejemplo-${i + 1}.jpg`,
      mime: "image/jpeg",
      bytes: null,
      sha,
      partialHash: sha,
      memberId: memberIds[i % Math.max(1, memberIds.length)] ?? "m0",
      batchId: null,
      takenAt,
    });
    const p = PLACES[i % 3 === 0 ? 2 : 3] as PlaceRow;
    locate(m, p.lat, p.lon, "gps");
    finishProcessing(m);
    db.media.push(m);
  }
}

// ── Rutas ──────────────────────────────────────────────────────────
type Ctx = { req: Request; url: URL; path: string; device: string | null; body: () => Promise<unknown> };
type Handler = (c: Ctx, params: Record<string, string>) => Response | Promise<Response>;
const routes: [string, string, Handler, "public" | "auth" | "member"][] = [];
const on = (method: string, pattern: string, h: Handler, access: "public" | "auth" | "member" = "auth") =>
  routes.push([method, pattern, h, access]);

function matchPath(pattern: string, path: string) {
  const p = pattern.split("/");
  const s = path.split("/");
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as string;
    if (a.startsWith(":")) out[a.slice(1)] = decodeURIComponent(s[i] as string);
    else if (a !== s[i]) return null;
  }
  return out;
}
const dev = (c: Ctx) => (c.device ? db.devices.get(c.device) : undefined);
const mediaOr404 = (mid: string) => db.media.find((m) => m.id === mid);

on("GET", E.health, () => json(S.HealthResponse, { ok: true, version: "mock" }), "public");
on("GET", E.setupStatus, () => json(S.SetupStatus, { setupDone: db.setupDone }), "public");
on(
  "POST",
  E.setup,
  async (c) => {
    if (db.setupDone) return fail(409, "already_setup", "La galería ya está configurada.");
    const b = S.SetupRequest.parse(await c.body());
    Object.assign(db, { setupDone: true, galleryName: b.galleryName, home: b.home, pin: b.pin });
    db.members = b.members.map((m) => ({ ...m, id: id("m"), archived: false }));
    const d = crypto.randomUUID();
    db.devices.set(d, { authed: true, memberId: null });
    return new Response(null, { status: 204, headers: { "Set-Cookie": setCookie(d) } });
  },
  "public",
);
on(
  "POST",
  E.authPin,
  async (c) => {
    const { pin } = S.AuthPinRequest.parse(await c.body());
    if (pin !== db.pin) return fail(401, "pin_invalid", "Ese PIN no es.");
    const d = crypto.randomUUID();
    db.devices.set(d, { authed: true, memberId: null });
    return new Response(null, { status: 204, headers: { "Set-Cookie": setCookie(d) } });
  },
  "public",
);
on("GET", E.me, (c) => {
  const memberId = dev(c)?.memberId;
  return json(S.MeResponse, {
    device: { id: c.device as string },
    member: db.members.find((m) => m.id === memberId) ?? null,
  });
});
on("POST", E.meMember, async (c) => {
  const { memberId } = S.SetMemberRequest.parse(await c.body());
  if (!db.members.some((m) => m.id === memberId)) return fail(404, "not_found", "No encontramos esa persona.");
  (dev(c) as { memberId: string | null }).memberId = memberId;
  return noContent();
});
on("GET", E.members, () => Response.json(db.members));
on("POST", E.members, async (c) => {
  const m = { ...S.MemberInput.parse(await c.body()), id: id("m"), archived: false };
  db.members.push(m);
  return json(S.Member, m, 201);
});
on("PATCH", "/members/:id", async (c, p) => {
  const m = db.members.find((x) => x.id === p.id);
  if (!m) return fail(404, "not_found", "No encontramos esa persona.");
  Object.assign(m, S.MemberPatch.parse(await c.body()));
  return json(S.Member, m);
});
on("GET", E.settings, () => json(S.Settings, { galleryName: db.galleryName, home: db.home }));
on("PATCH", E.settings, async (c) => {
  const b = S.SettingsPatch.parse(await c.body());
  if (b.galleryName) db.galleryName = b.galleryName;
  if (b.home) db.home = b.home;
  if (b.pin) db.pin = b.pin;
  return json(S.Settings, { galleryName: db.galleryName, home: db.home });
});

on("POST", E.precheck, async (c) => {
  const { files } = S.PrecheckRequest.parse(await c.body());
  return json(
    S.PrecheckResponse,
    files.map((f) => {
      const m = db.media.find((x) => x.partialHash === f.partialHash && (x.bytes?.length ?? -1) === f.size);
      return m ? { exists: true, mediaId: m.id } : { exists: false };
    }),
  );
});
on(
  "POST",
  E.batches,
  async (c) => {
    const { source } = S.BatchCreate.parse(await c.body());
    const batchId = id("bt");
    db.batches.set(batchId, {
      memberId: dev(c)?.memberId ?? null,
      mediaIds: [],
      duplicates: 0,
      source,
      createdAt: new Date().toISOString(),
    });
    return json(S.BatchCreated, { batchId }, 201);
  },
  "member",
);
on("GET", "/batches/:id/summary", (_c, p) => {
  const b = db.batches.get(p.id as string);
  if (!b) return fail(404, "not_found", "No encontramos esa subida.");
  const items = b.mediaIds.map(mediaOr404).filter((m): m is Media => !!m);
  const byPlace = new Map<string, number>();
  for (const m of items) if (m.placeId) byPlace.set(m.placeId, (byPlace.get(m.placeId) ?? 0) + 1);
  return json(S.BatchSummary, {
    batchId: p.id as string,
    total: items.length + b.duplicates,
    newCount: items.length,
    duplicateCount: b.duplicates,
    processingCount: items.filter((m) => m.status === "processing").length,
    places: [...byPlace]
      .sort((a, b) => b[1] - a[1])
      .map(([placeId, count]) => ({ placeId, count, name: db.places.find((x) => x.id === placeId)?.name ?? "" })),
    noLocation: items
      .filter((m) => m.status === "ready" && m.lat === null)
      .map((m) => ({ media: pub(m), suggestion: suggestionFor(m) })),
  });
});

// tus (subconjunto: creation + HEAD + PATCH)
const TUS = { "Tus-Resumable": "1.0.0" };
on(
  "OPTIONS",
  E.tus,
  () =>
    new Response(null, {
      status: 204,
      headers: { ...TUS, "Tus-Version": "1.0.0", "Tus-Extension": "creation", "Tus-Max-Size": String(50 * 2 ** 30) },
    }),
  "member",
);
on(
  "POST",
  E.tus,
  (c) => {
    const length = Number(c.req.headers.get("upload-length"));
    if (!Number.isFinite(length) || length < 0) return fail(400, "invalid", "Falta Upload-Length.");
    const meta: Record<string, string> = {};
    for (const pair of (c.req.headers.get("upload-metadata") ?? "").split(",")) {
      const [k, v] = pair.trim().split(" ");
      if (k) meta[k] = v ? Buffer.from(v, "base64").toString("utf8") : "";
    }
    const uid = id("up");
    db.uploads.set(uid, { length, parts: [], offset: 0, meta });
    return new Response(null, { status: 201, headers: { ...TUS, Location: `${API_PREFIX}${E.tus}/${uid}` } });
  },
  "member",
);
on(
  "HEAD",
  "/tus/:id",
  (_c, p) => {
    const u = db.uploads.get(p.id as string);
    if (!u) return new Response(null, { status: 404, headers: TUS });
    return new Response(null, {
      status: 200,
      headers: {
        ...TUS,
        "Upload-Offset": String(u.offset),
        "Upload-Length": String(u.length),
        "Cache-Control": "no-store",
      },
    });
  },
  "member",
);
on(
  "PATCH",
  "/tus/:id",
  async (c, p) => {
    const u = db.uploads.get(p.id as string);
    if (!u) return new Response(null, { status: 404, headers: TUS });
    if (Number(c.req.headers.get("upload-offset")) !== u.offset)
      return new Response(null, { status: 409, headers: TUS });
    const chunk = new Uint8Array(await c.req.arrayBuffer());
    u.parts.push(chunk);
    u.offset += chunk.length;
    if (u.offset >= u.length) {
      db.uploads.delete(p.id as string);
      await finalizeUpload(u, dev(c)?.memberId ?? null);
    }
    return new Response(null, { status: 204, headers: { ...TUS, "Upload-Offset": String(u.offset) } });
  },
  "member",
);

on("GET", E.home, () => {
  const today = new Date();
  const groups = new Map<number, Media[]>();
  for (const m of ready()) {
    if (!m.takenAt) continue;
    const d = new Date(m.takenAt);
    const years = today.getFullYear() - d.getFullYear();
    if (years > 0 && d.getMonth() === today.getMonth() && d.getDate() === today.getDate())
      groups.set(years, [...(groups.get(years) ?? []), m]);
  }
  const trips = [...db.trips.values()].map(tripOut).filter((t) => t.count > 0);
  const last = trips.sort((a, b) => b.endAt.localeCompare(a.endAt))[0];
  const per = new Map<string, number>();
  if (last) for (const m of ready()) if (m.tripId === last.id) per.set(m.memberId, (per.get(m.memberId) ?? 0) + 1);
  return json(S.HomeResponse, {
    galleryName: db.galleryName,
    onThisDay: [...groups].map(([yearsAgo, ms]) => ({ yearsAgo, media: ms.map(pub) })),
    lastTrip: last ? { trip: last, perMember: [...per].map(([memberId, count]) => ({ memberId, count })) } : null,
  });
});
on("GET", E.places, () => Response.json(db.places.map(placeOut).filter((p) => p.count > 0)));
on("GET", "/places/:id", (_c, p) => {
  const place = db.places.find((x) => x.id === p.id);
  if (!place) return fail(404, "not_found", "No encontramos ese lugar.");
  const items = ready()
    .filter((m) => m.placeId === place.id)
    .sort((a, b) => (b.takenAt ?? "").localeCompare(a.takenAt ?? ""));
  const groups = new Map<string | null, Media[]>();
  for (const m of items) groups.set(m.tripId, [...(groups.get(m.tripId) ?? []), m]);
  const trip = (tid: string | null) => {
    const t = [...db.trips.values()].find((x) => x.id === tid);
    return t ? tripOut(t) : null;
  };
  return json(S.PlaceDetail, {
    place: placeOut(place),
    groups: [...groups].map(([tid, ms]) => ({ trip: trip(tid), media: ms.map(pub) })),
  });
});
on("GET", E.trips, () => Response.json([...db.trips.values()].map(tripOut).filter((t) => t.count > 0)));
on("GET", "/trips/:id", (_c, p) => {
  const t = [...db.trips.values()].find((x) => x.id === p.id);
  if (!t) return fail(404, "not_found", "No encontramos ese viaje.");
  return json(S.TripDetail, {
    trip: tripOut(t),
    media: ready()
      .filter((m) => m.tripId === t.id)
      .map(pub),
  });
});
on("PATCH", "/trips/:id", async (c, p) => {
  const t = [...db.trips.values()].find((x) => x.id === p.id);
  if (!t) return fail(404, "not_found", "No encontramos ese viaje.");
  Object.assign(t, { name: S.TripPatch.parse(await c.body()).name, nameIsCustom: true });
  return json(S.Trip, tripOut(t));
});
on("PUT", "/trips/:id/members", async (c, p) => {
  const t = [...db.trips.values()].find((x) => x.id === p.id);
  if (!t) return fail(404, "not_found", "No encontramos ese viaje.");
  const { memberIds } = S.TripMembers.parse(await c.body());
  t.memberIds = memberIds.length ? [...new Set(memberIds)] : undefined;
  return json(S.Trip, tripOut(t));
});
// Unir: las fotos del otro pasan a este. Separar en el mock solo apaga la marca (no hay recálculo).
on("POST", "/trips/:id/merge", async (c, p) => {
  const keep = [...db.trips.values()].find((x) => x.id === p.id);
  const { otherId } = S.TripMerge.parse(await c.body());
  const other = [...db.trips.values()].find((x) => x.id === otherId);
  if (!keep || !other || keep === other) return fail(404, "not_found", "No encontramos ese viaje.");
  for (const m of db.media) if (m.tripId === other.id) m.tripId = keep.id;
  keep.merged = true;
  return json(S.TripMergeResponse, { tripId: keep.id });
});
on("DELETE", "/trips/:id/merge", (_c, p) => {
  const t = [...db.trips.values()].find((x) => x.id === p.id);
  if (!t) return fail(404, "not_found", "No encontramos ese viaje.");
  t.merged = false;
  return noContent();
});
on("GET", E.activity, () => {
  const processing = db.media
    .filter((m) => m.status === "processing")
    .map((m) => ({ media: pub(m), steps: ["thumb" as const], running: true }));
  const batches = [...db.batches]
    .filter(([, b]) => b.mediaIds.length > 0)
    .reverse()
    .slice(0, 10)
    .map(([batchId, b]) => {
      const items = db.media.filter((m) => b.mediaIds.includes(m.id));
      return {
        batchId,
        memberId: b.memberId ?? (db.members[0]?.id as string),
        source: b.source,
        createdAt: b.createdAt,
        total: items.length,
        processing: items.filter((m) => m.status === "processing").length,
        items: items.slice(0, 8).map(pub),
      };
    });
  return json(S.ActivityResponse, {
    processing,
    processingTotal: processing.length,
    failed: db.media.filter((m) => m.status === "error").map(pub),
    batches,
  });
});
on("GET", E.media, (c) => {
  const q = S.MediaListQuery.parse(Object.fromEntries(c.url.searchParams));
  let items = ready();
  if (q.placeId) items = items.filter((m) => m.placeId === q.placeId);
  if (q.tripId) items = items.filter((m) => m.tripId === q.tripId);
  if (q.memberId) items = items.filter((m) => m.memberId === q.memberId);
  if (q.favorites === "1") items = items.filter((m) => m.favorite);
  if (q.noLocation === "1") items = items.filter((m) => m.lat === null);
  const start = Number(q.cursor ?? 0);
  const page = items.slice(start, start + q.limit);
  return json(S.MediaPage, {
    items: page.map(pub),
    nextCursor: start + q.limit < items.length ? String(start + q.limit) : null,
  });
});
on("GET", "/media/:id", (_c, p) => {
  const m = mediaOr404(p.id as string);
  return m ? json(S.MediaItem, pub(m)) : fail(404, "not_found", "No encontramos esa foto.");
});
on("DELETE", "/media/:id", (_c, p) => {
  db.media = db.media.filter((m) => m.id !== p.id);
  db.similar = db.similar.filter((s) => s.a !== p.id && s.b !== p.id);
  return noContent();
});
on("POST", "/places/:id/delete-all", async (c, p) => {
  const place = db.places.find((x) => x.id === p.id);
  if (!place) return fail(404, "not_found", "No encontramos ese lugar.");
  const { confirmName } = S.PlaceDeleteAll.parse(await c.body());
  if (!S.sameName(confirmName, place.name))
    return fail(400, "confirm_mismatch", "El nombre no coincide. Escribilo igual que el del lugar para borrar.");
  const gone = new Set(db.media.filter((m) => m.placeId === place.id).map((m) => m.id));
  db.media = db.media.filter((m) => !gone.has(m.id));
  db.similar = db.similar.filter((s) => !gone.has(s.a) && !gone.has(s.b));
  return json(S.DeletedCount, { deleted: gone.size });
});
on("POST", E.mediaDeleteBulk, async (c) => {
  const gone = new Set(S.MediaDeleteBulk.parse(await c.body()).mediaIds);
  const before = db.media.length;
  db.media = db.media.filter((m) => !gone.has(m.id));
  db.similar = db.similar.filter((s) => !gone.has(s.a) && !gone.has(s.b));
  return json(S.DeletedCount, { deleted: before - db.media.length });
});
on("PATCH", "/media/:id/location", async (c, p) => {
  const m = mediaOr404(p.id as string);
  if (!m) return fail(404, "not_found", "No encontramos esa foto.");
  const at = S.LocationPatch.parse(await c.body());
  locate(m, at.lat, at.lon, "manual");
  return json(S.MediaItem, pub(m));
});
on("POST", E.mediaLocationBulk, async (c) => {
  const b = S.LocationBulk.parse(await c.body());
  for (const mid of b.mediaIds) {
    const m = mediaOr404(mid);
    if (m) locate(m, b.lat, b.lon, "manual");
  }
  return noContent();
});
for (const method of ["POST", "DELETE"])
  on(method, "/media/:id/favorite", (_c, p) => {
    const m = mediaOr404(p.id as string);
    if (!m) return fail(404, "not_found", "No encontramos esa foto.");
    m.favorite = method === "POST";
    return noContent();
  });

on("GET", E.inboxNoLocation, () =>
  json(S.NoLocationInbox, {
    items: ready()
      .filter((m) => m.lat === null)
      .map((m) => ({ media: pub(m), suggestion: suggestionFor(m) })),
  }),
);
on("GET", E.inboxSimilar, () =>
  json(S.SimilarInbox, {
    items: db.similar
      .filter((s) => s.status === "pending")
      .flatMap((s) => {
        const a = mediaOr404(s.a);
        const b = mediaOr404(s.b);
        return a && b ? [{ id: s.id, a: pub(a), b: pub(b), distance: 3 }] : [];
      }),
  }),
);
on("POST", "/inbox/similar/:id", async (c, p) => {
  const { action } = S.SimilarAction.parse(await c.body());
  const s = db.similar.find((x) => x.id === p.id);
  if (s) s.status = action;
  return noContent();
});
on("GET", E.adminStatus, () =>
  json(S.AdminStatus, {
    queue: { queued: 3, running: 1, failed: 1, byType: { thumb: { queued: 3, running: 1 } } },
    errors: [
      {
        jobId: "j1",
        mediaId: null,
        type: "video_transcode",
        error: "Archivo de ejemplo dañado",
        at: new Date().toISOString(),
      },
    ],
    volumes: [
      {
        id: "v1",
        tier: "fast",
        path: "/data/fast",
        usedBytes: 40e9,
        freeBytes: 60e9,
        totalBytes: 100e9,
        usedPercent: 40,
        alert: false,
      },
      {
        id: "v2",
        tier: "bulk",
        path: "/data/bulk1",
        usedBytes: 88e10,
        freeBytes: 12e10,
        totalBytes: 1e12,
        usedPercent: 88,
        alert: true,
      },
    ],
    gpu: { nvenc: false },
    worker: { alive: true, seenAt: new Date().toISOString() },
  }),
);
on("POST", E.adminRetryFailed, () => noContent());
on("POST", E.castSign, async (c) => {
  const { mediaIds } = S.CastSignRequest.parse(await c.body());
  const items = mediaIds.flatMap((mid) => {
    const m = mediaOr404(mid);
    if (!m) return [];
    const url = m.kind === "video" ? m.videoUrl : m.previewUrl;
    return url
      ? [
          {
            mediaId: m.id,
            url: `${url}?firma=mock`,
            contentType: m.kind === "video" ? "video/mp4" : "image/svg+xml",
            posterUrl: m.posterUrl,
          },
        ]
      : [];
  });
  return json(S.CastSignResponse, { items });
});
on("POST", E.shortcutTokens, async (c) => {
  const b = S.ShortcutTokenCreate.parse(await c.body());
  const tok = {
    id: id("tk"),
    memberId: b.memberId,
    label: b.label,
    createdAt: new Date().toISOString(),
    revoked: false,
  };
  db.tokens.push(tok);
  return json(S.ShortcutTokenCreated, { ...tok, token: `lfg_${crypto.randomUUID().replaceAll("-", "")}` }, 201);
});
on("DELETE", "/shortcut/tokens/:id", (_c, p) => {
  const tk = db.tokens.find((x) => x.id === p.id);
  if (tk) tk.revoked = true;
  return noContent();
});
on("GET", E.events, () => {
  let send: (d: string) => void = () => {};
  const stream = new ReadableStream<string>({
    start(ctrl) {
      send = (d) => ctrl.enqueue(`data: ${d}\n\n`);
      listeners.add(send);
      ctrl.enqueue(": hola\n\n");
    },
    cancel() {
      listeners.delete(send);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
});

// Archivos (en el backend real son públicos por URL inmutable o con cookie; acá alcanza).
on(
  "GET",
  "/files/:sha/:file",
  (_c, p) => {
    const m = db.media.find((x) => x.sha256 === p.sha);
    if (!m) return fail(404, "not_found", "No encontramos ese archivo.");
    if (p.file === "original" || p.file === "video.mp4") {
      if (!m.bytes)
        return new Response(thumbSvg(m.sha256, m.originalName), { headers: { "Content-Type": "image/svg+xml" } });
      const headers: Record<string, string> = { "Content-Type": m.mime || "application/octet-stream" };
      if (p.file === "original")
        headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(m.originalName)}`;
      return new Response(m.bytes as BlobPart as Uint8Array<ArrayBuffer>, { headers });
    }
    return new Response(thumbSvg(m.sha256, p.file === "thumb.webp" ? "" : m.originalName), {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  },
  "public",
);

// Sólo para pruebas.
on(
  "POST",
  "/__mock/reset",
  () => {
    db = fresh();
    return noContent();
  },
  "public",
);
on(
  "POST",
  "/__mock/seed",
  async (c) => {
    const { count } = (await c.body()) as { count: number };
    seed(Math.min(5000, Number(count) || 0));
    return noContent();
  },
  "public",
);

async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.slice(API_PREFIX.length) || "/";
  for (const [method, pattern, h, access] of routes) {
    if (method !== req.method && !(req.method === "HEAD" && method === "GET" && false)) continue;
    const params = matchPath(pattern, path);
    if (!params) continue;
    const device = cookieOf(req);
    const d = device ? db.devices.get(device) : undefined;
    if (access !== "public") {
      if (!db.setupDone) return fail(409, "setup_required", "Falta configurar la galería.");
      if (!d?.authed) return fail(401, "pin_required", "Falta el PIN familiar.");
      if (access === "member" && !d.memberId) return fail(409, "member_required", "Falta elegir quién sos.");
    }
    const ctx: Ctx = { req, url, path, device, body: () => req.json() };
    try {
      return await h(ctx, params);
    } catch (e) {
      if (e && typeof e === "object" && "issues" in e)
        return fail(400, "invalid", "Faltan datos o hay alguno mal escrito.");
      console.error(e);
      return fail(500, "internal", "Algo salió mal. Probá de nuevo en un rato.");
    }
  }
  return fail(404, "not_found", "No encontramos eso.");
}

async function serveDist(url: URL) {
  if (!DIST) return new Response("Mock de la API: la web corre con Vite.", { status: 404 });
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = Bun.file(join(DIST, rel));
  if (rel !== "/" && (await file.exists())) return new Response(file);
  return new Response(Bun.file(join(DIST, "index.html")), { headers: { "Content-Type": "text/html" } });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith(`${API_PREFIX}/`)) return handleApi(req, url);
    return serveDist(url);
  },
});
console.log(`mock de la API en http://localhost:${server.port}${DIST ? ` (sirve ${DIST})` : ""}`);

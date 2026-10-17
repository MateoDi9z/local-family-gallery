// Contratos de la API (/api). Se validan en el servidor (entrada) y en la web (respuestas).
import { z } from "zod";

export const Id = z.string().min(1).max(64);
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const IsoDate = z.string(); // ISO 8601
export const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const Pin = z.string().regex(/^\d{4,8}$/);

export const ErrorResponse = z.object({ error: z.string(), message: z.string() });

// ── Sistema y acceso ───────────────────────────────────────────────
export const HealthResponse = z.object({ ok: z.literal(true), version: z.string() });
export const SetupStatus = z.object({ setupDone: z.boolean() });

export const MemberInput = z.object({ name: z.string().trim().min(1).max(40), color: Color });
export const Member = MemberInput.extend({ id: Id, archived: z.boolean() });
export const MemberPatch = MemberInput.partial().extend({ archived: z.boolean().optional() });

export const SetupRequest = z.object({
  galleryName: z.string().trim().min(1).max(80),
  members: z.array(MemberInput).min(1).max(30),
  home: LatLon,
  pin: Pin,
});
export const AuthPinRequest = z.object({ pin: Pin });
export const MeResponse = z.object({ device: z.object({ id: Id }), member: Member.nullable() });
export const SetMemberRequest = z.object({ memberId: Id });

export const Settings = z.object({ galleryName: z.string(), home: LatLon });
export const SettingsPatch = z.object({
  galleryName: z.string().trim().min(1).max(80).optional(),
  home: LatLon.optional(),
  pin: Pin.optional(),
});

// ── Subida ─────────────────────────────────────────────────────────
export const PrecheckRequest = z.object({
  files: z.array(z.object({ size: z.number().int().nonnegative(), partialHash: Sha256 })).max(10000),
});
/** Mismo orden que `files` del request. */
export const PrecheckResponse = z.array(z.object({ exists: z.boolean(), mediaId: Id.optional() }));

export const BatchSource = z.enum(["web", "share", "shortcut", "desktop"]);
export const BatchCreate = z.object({ source: BatchSource });
export const BatchCreated = z.object({ batchId: Id });

/** Metadata que manda Uppy en cada subida tus. `lastModified` en ms desde epoch, como texto. */
export const TusMetadata = z.object({
  filename: z.string().min(1).max(255),
  filetype: z.string().max(100).default(""),
  batchId: Id,
  lastModified: z.string().regex(/^\d+$/).optional(),
});

export const LocationSuggestion = z.object({
  lat: z.number(),
  lon: z.number(),
  placeName: z.string().nullable(),
  fromMediaId: Id,
  /** 0..1, baja con la distancia temporal. */
  confidence: z.number().min(0).max(1),
});

// ── Ver ────────────────────────────────────────────────────────────
export const MediaKind = z.enum(["photo", "video"]);
export const LocationSource = z.enum(["gps", "suggested", "manual"]);
export const MediaStatus = z.enum(["processing", "ready", "error"]);

export const MediaItem = z.object({
  id: Id,
  kind: MediaKind,
  sha256: Sha256,
  originalName: z.string(),
  memberId: Id,
  takenAt: IsoDate.nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  locationSource: LocationSource.nullable(),
  locationConfirmed: z.boolean(),
  placeId: Id.nullable(),
  tripId: Id.nullable(),
  status: MediaStatus,
  favorite: z.boolean(),
  /** URLs inmutables; null mientras el derivado no exista. */
  thumbUrl: z.string().nullable(),
  previewUrl: z.string().nullable(),
  posterUrl: z.string().nullable(),
  videoUrl: z.string().nullable(),
  originalUrl: z.string(),
});

export const BatchSummary = z.object({
  batchId: Id,
  total: z.number().int(),
  newCount: z.number().int(),
  duplicateCount: z.number().int(),
  processingCount: z.number().int(),
  places: z.array(z.object({ placeId: Id, name: z.string(), count: z.number().int() })),
  noLocation: z.array(z.object({ media: MediaItem, suggestion: LocationSuggestion.nullable() })),
});

export const Place = z.object({
  id: Id,
  name: z.string(),
  admin1: z.string().nullable(),
  countryCode: z.string(),
  lat: z.number(),
  lon: z.number(),
  count: z.number().int(),
  coverThumbUrl: z.string().nullable(),
});

export const Trip = z.object({
  id: Id,
  name: z.string(),
  nameIsCustom: z.boolean(),
  startAt: IsoDate,
  endAt: IsoDate,
  count: z.number().int(),
  coverThumbUrl: z.string().nullable(),
});
export const TripPatch = z.object({ name: z.string().trim().min(1).max(80) });
export const TripDetail = z.object({ trip: Trip, media: z.array(MediaItem) });

/** Grupos de un lugar: un viaje, o `trip: null` para las fotos sin viaje (locales). */
export const PlaceDetail = z.object({
  place: Place,
  groups: z.array(z.object({ trip: Trip.nullable(), media: z.array(MediaItem) })),
});

export const HomeResponse = z.object({
  galleryName: z.string(),
  onThisDay: z.array(z.object({ yearsAgo: z.number().int().positive(), media: z.array(MediaItem) })),
  lastTrip: z
    .object({ trip: Trip, perMember: z.array(z.object({ memberId: Id, count: z.number().int() })) })
    .nullable(),
});

export const MediaListQuery = z.object({
  placeId: Id.optional(),
  tripId: Id.optional(),
  memberId: Id.optional(),
  favorites: z.enum(["1", "0"]).optional(),
  noLocation: z.enum(["1", "0"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const MediaPage = z.object({ items: z.array(MediaItem), nextCursor: z.string().nullable() });

export const LocationPatch = LatLon;
export const LocationBulk = LatLon.extend({ mediaIds: z.array(Id).min(1).max(10000) });

// ── Bandejas y administración ──────────────────────────────────────
export const NoLocationInbox = z.object({
  items: z.array(z.object({ media: MediaItem, suggestion: LocationSuggestion.nullable() })),
});
export const SimilarPair = z.object({ id: Id, a: MediaItem, b: MediaItem, distance: z.number().int() });
export const SimilarInbox = z.object({ items: z.array(SimilarPair) });
/** Borrar es otra acción explícita: DELETE /media/:id. */
export const SimilarAction = z.object({ action: z.enum(["kept_both", "dismissed"]) });

export const VolumeStatus = z.object({
  id: Id,
  tier: z.enum(["fast", "bulk"]),
  path: z.string(),
  usedBytes: z.number(),
  freeBytes: z.number(),
  totalBytes: z.number(),
  usedPercent: z.number(),
  alert: z.boolean(),
});
export const AdminStatus = z.object({
  queue: z.object({
    queued: z.number().int(),
    running: z.number().int(),
    failed: z.number().int(),
    byType: z.record(z.string(), z.object({ queued: z.number().int(), running: z.number().int() })),
  }),
  errors: z.array(z.object({ jobId: Id, mediaId: Id.nullable(), type: z.string(), error: z.string(), at: IsoDate })),
  volumes: z.array(VolumeStatus),
  gpu: z.object({ nvenc: z.boolean() }).nullable(),
});

/** Eventos SSE de GET /events (campo `data` en JSON). */
export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("media"), mediaId: Id, status: MediaStatus, step: z.string() }),
  z.object({ type: z.literal("queue"), queued: z.number().int(), running: z.number().int() }),
]);

// ── Atajo de iOS y Chromecast ──────────────────────────────────────
export const ShortcutTokenCreate = z.object({ memberId: Id, label: z.string().trim().min(1).max(40) });
export const ShortcutToken = z.object({
  id: Id,
  memberId: Id,
  label: z.string(),
  createdAt: IsoDate,
  revoked: z.boolean(),
});
/** El token en claro se muestra una sola vez. */
export const ShortcutTokenCreated = ShortcutToken.extend({ token: z.string() });
/** El Atajo puede mandar varios archivos (campo `file` repetido) en un mismo request = un lote. */
export const ShortcutUploadResponse = z.object({
  batchId: Id,
  items: z.array(z.object({ name: z.string(), mediaId: Id, duplicate: z.boolean() })),
});

/** URLs firmadas y de corta duración: el Chromecast no tiene la cookie del dispositivo. */
export const CastSignRequest = z.object({ mediaIds: z.array(Id).min(1).max(500) });
export const CastSignResponse = z.object({
  items: z.array(z.object({ mediaId: Id, url: z.string(), contentType: z.string(), posterUrl: z.string().nullable() })),
});

export type Member = z.infer<typeof Member>;
export type MediaItem = z.infer<typeof MediaItem>;
export type Place = z.infer<typeof Place>;
export type Trip = z.infer<typeof Trip>;
export type BatchSummary = z.infer<typeof BatchSummary>;
export type HomeResponse = z.infer<typeof HomeResponse>;
export type AdminStatus = z.infer<typeof AdminStatus>;
export type ServerEvent = z.infer<typeof ServerEvent>;
export type LocationSuggestion = z.infer<typeof LocationSuggestion>;

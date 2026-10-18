// Rutas de la API (relativas a /api) y URLs de archivos. Única fuente para web y servidor.

export const API_PREFIX = "/api";

export const endpoints = {
  health: "/health",
  setupStatus: "/setup/status",
  setup: "/setup",
  authPin: "/auth/pin",
  me: "/me",
  meMember: "/me/member",
  members: "/members",
  member: (id: string) => `/members/${id}`,
  settings: "/settings",
  precheck: "/uploads/precheck",
  batches: "/batches",
  batchSummary: (id: string) => `/batches/${id}/summary`,
  tus: "/tus",
  shortcutUpload: "/shortcut/upload",
  shortcutTokens: "/shortcut/tokens",
  shortcutToken: (id: string) => `/shortcut/tokens/${id}`,
  home: "/home",
  places: "/places",
  place: (id: string) => `/places/${id}`,
  placeDeleteAll: (id: string) => `/places/${id}/delete-all`,
  trips: "/trips",
  trip: (id: string) => `/trips/${id}`,
  tripMerge: (id: string) => `/trips/${id}/merge`,
  media: "/media",
  mediaItem: (id: string) => `/media/${id}`,
  mediaLocation: (id: string) => `/media/${id}/location`,
  mediaLocationBulk: "/media/location-bulk",
  mediaDeleteBulk: "/media/delete-bulk",
  mediaFavorite: (id: string) => `/media/${id}/favorite`,
  inboxNoLocation: "/inbox/no-location",
  inboxSimilar: "/inbox/similar",
  inboxSimilarItem: (id: string) => `/inbox/similar/${id}`,
  adminStatus: "/admin/status",
  adminRetryFailed: "/admin/jobs/retry",
  events: "/events",
  castSign: "/cast/sign",
} as const;

export const DerivativeVariant = ["thumb", "preview", "poster", "video"] as const;
export type DerivativeVariant = (typeof DerivativeVariant)[number];
export const DERIVATIVE_EXT: Record<DerivativeVariant, string> = {
  thumb: "webp",
  preview: "webp",
  poster: "webp",
  video: "mp4",
};

/** URL inmutable de un derivado (Cache-Control: immutable). */
export const fileUrl = (sha256: string, variant: DerivativeVariant) =>
  `${API_PREFIX}/files/${sha256}/${variant}.${DERIVATIVE_EXT[variant]}`;
export const originalUrl = (sha256: string) => `${API_PREFIX}/files/${sha256}/original`;

/** Cookie de dispositivo (larga duración, httpOnly). */
export const DEVICE_COOKIE = "lfg_device";

// Chromecast con el Cast Web Sender SDK y el Default Media Receiver. La tele solo muestra;
// el celu es el control remoto (anterior, siguiente, pausa, slideshow).
import { CastSignResponse, endpoints, type MediaItem } from "@lfg/shared";
import type { z } from "zod";
import { api } from "./api/client";
import { createStore } from "./store";

const SDK = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
const SLIDE_MS = 6000;

// Tipos mínimos del SDK (no publica paquete de tipos propio para el framework).
type CastSession = {
  loadMedia(req: unknown): Promise<unknown>;
  endSession(stop: boolean): void;
  getCastDevice(): { friendlyName: string };
};
type CastContext = {
  setOptions(o: Record<string, unknown>): void;
  requestSession(): Promise<unknown>;
  getCurrentSession(): CastSession | null;
  getCastState(): string;
  addEventListener(type: string, cb: (e: { sessionState: string; castState: string }) => void): void;
};
type RemotePlayer = { isPaused: boolean; playerState: string | null };
type RemoteController = {
  playOrPause(): void;
  addEventListener(type: string, cb: (e: { field: string; value: unknown }) => void): void;
};
type CastNs = {
  framework: {
    CastContext: { getInstance(): CastContext };
    CastContextEventType: { SESSION_STATE_CHANGED: string; CAST_STATE_CHANGED: string };
    CastState: { NO_DEVICES_AVAILABLE: string };
    SessionState: { SESSION_STARTED: string; SESSION_RESUMED: string; SESSION_ENDED: string };
    RemotePlayer: new () => RemotePlayer;
    RemotePlayerController: new (p: RemotePlayer) => RemoteController;
    RemotePlayerEventType: { ANY_CHANGE: string };
  };
};
type ChromeCastNs = {
  cast: {
    AutoJoinPolicy: { ORIGIN_SCOPED: string };
    media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: string;
      MediaInfo: new (url: string, type: string) => { metadata: unknown };
      PhotoMediaMetadata: new () => { title?: string };
      GenericMediaMetadata: new () => { title?: string; images?: unknown[] };
      LoadRequest: new (info: unknown) => unknown;
    };
    Image: new (url: string) => unknown;
  };
};
declare global {
  interface Window {
    __onGCastApiAvailable?: (ok: boolean) => void;
    cast?: CastNs;
    chrome?: ChromeCastNs;
  }
}

export const castState = createStore({
  available: false,
  /** Hay al menos una tele con Chromecast en este wifi (según el SDK). */
  devices: false,
  connected: false,
  device: "",
  index: 0,
  total: 0,
  slideshow: false,
  paused: false,
});
const patch = (p: Partial<ReturnType<typeof castState.get>>) => castState.set((s) => ({ ...s, ...p }));

type Signed = z.infer<typeof CastSignResponse>["items"][number];
let queue: Signed[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let player: RemotePlayer | undefined;
let controller: RemoteController | undefined;

const ctx = () => window.cast?.framework.CastContext.getInstance();
const absolute = (u: string) => new URL(u, location.origin).href;

export function initCast() {
  // Solo navegadores basados en Chrome tienen Cast; en el resto no se carga nada.
  if (!/Chrome\//.test(navigator.userAgent) || /iPhone|iPad/.test(navigator.userAgent)) return;
  window.__onGCastApiAvailable = (ok) => {
    const c = ctx();
    const f = window.cast?.framework;
    const ch = window.chrome?.cast;
    if (!ok || !c || !f || !ch) return;
    c.setOptions({
      receiverApplicationId: ch.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: ch.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    player = new f.RemotePlayer();
    controller = new f.RemotePlayerController(player);
    controller.addEventListener(f.RemotePlayerEventType.ANY_CHANGE, (e) => {
      if (e.field === "isPaused") patch({ paused: Boolean(e.value) });
      // Un video terminó durante el slideshow: pasar al siguiente.
      if (e.field === "playerState" && e.value === "IDLE" && castState.get().slideshow && !timer) next();
    });
    const devices = (s: string) => patch({ devices: s !== f.CastState.NO_DEVICES_AVAILABLE });
    c.addEventListener(f.CastContextEventType.CAST_STATE_CHANGED, (e) => devices(e.castState));
    devices(c.getCastState());
    c.addEventListener(f.CastContextEventType.SESSION_STATE_CHANGED, (e) => {
      const s = f.SessionState;
      if (e.sessionState === s.SESSION_STARTED || e.sessionState === s.SESSION_RESUMED)
        patch({ connected: true, device: c.getCurrentSession()?.getCastDevice().friendlyName ?? "" });
      if (e.sessionState === s.SESSION_ENDED) {
        clearTimeout(timer);
        timer = undefined;
        patch({ connected: false, slideshow: false });
      }
    });
    patch({ available: true });
  };
  const s = document.createElement("script");
  s.src = SDK;
  s.async = true;
  document.head.append(s);
}

/** Manda una lista a la tele empezando en `index`. Las URLs se firman: la tele no tiene la cookie. */
export async function castItems(items: MediaItem[], index: number, slideshow = false) {
  const c = ctx();
  if (!c) return;
  if (!c.getCurrentSession()) await c.requestSession();
  const ids = items.map((m) => m.id);
  const start = Math.max(0, Math.min(index, ids.length - 1));
  // El contrato firma hasta 500: tomamos una ventana alrededor de la elegida.
  const from = Math.max(0, start - 250);
  const res = await api.post(endpoints.castSign, { mediaIds: ids.slice(from, from + 500) }, CastSignResponse);
  queue = res.items;
  patch({ total: queue.length, slideshow });
  show(start - from);
}

function show(i: number) {
  const session = ctx()?.getCurrentSession();
  const ch = window.chrome?.cast;
  const item = queue[i];
  if (!session || !ch || !item) return;
  const info = new ch.media.MediaInfo(absolute(item.url), item.contentType);
  const meta = new ch.media.GenericMediaMetadata();
  if (item.posterUrl) meta.images = [new ch.Image(absolute(item.posterUrl))];
  info.metadata = meta;
  session.loadMedia(new ch.media.LoadRequest(info)).catch(() => {});
  patch({ index: i, paused: false });
  clearTimeout(timer);
  timer = undefined;
  if (castState.get().slideshow && item.contentType.startsWith("image/")) timer = setTimeout(next, SLIDE_MS);
}

export const next = () => show((castState.get().index + 1) % Math.max(1, queue.length));
export const prev = () => show((castState.get().index - 1 + queue.length) % Math.max(1, queue.length));

export function togglePause() {
  const s = castState.get();
  const item = queue[s.index];
  if (item?.contentType.startsWith("video/")) controller?.playOrPause();
  else if (s.slideshow) {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
      patch({ paused: true });
    } else {
      patch({ paused: false });
      timer = setTimeout(next, SLIDE_MS);
    }
  }
}

/** Abre la lista de teles de Chrome, sin mandar nada todavía (para probar desde la guía). */
export const connectCast = () =>
  ctx()
    ?.requestSession()
    .catch(() => {});

export function stopCast() {
  clearTimeout(timer);
  timer = undefined;
  ctx()?.getCurrentSession()?.endSession(true);
}

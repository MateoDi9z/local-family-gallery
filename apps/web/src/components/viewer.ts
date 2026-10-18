// Visor PhotoSwipe 5: swipe, pantalla completa, video, "Descargar original", favorita, tele y borrar.
// En iPhone la tele va por AirPlay: los videos con el selector de AirPlay y las fotos con una presentación
// que pasa sola, para verla con "Duplicar pantalla".
import "photoswipe/style.css";
import { endpoints, type MediaItem } from "@lfg/shared";
import PhotoSwipe from "photoswipe";
import { api, errorText } from "../api/client";
import { castItems, castState, type Platform, platform, SLIDE_MS } from "../cast";
import { t } from "../i18n";
import { iconSvg } from "./icons";

/** Alto de la barra de arriba de PhotoSwipe (contador, zoom y cerrar). */
const TOP_BAR_PX = 60;

/** Botón de la barra: ícono con un texto corto abajo; `name` es lo que lee el lector de pantalla. */
function action<K extends "a" | "button">(tag: K, icon: string, label: string, name = label) {
  const b = document.createElement(tag);
  if (b instanceof HTMLButtonElement) b.type = "button";
  b.className = "btn";
  b.innerHTML = `${icon}<span>${label}</span>`;
  b.setAttribute("aria-label", name);
  return b;
}

type AirPlayVideo = HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void };

export type ViewerOptions = {
  /** Alguien borró la foto que estaba viendo: el visor se cierra y la pantalla recarga. */
  onDeleted?: () => void;
  /** Empezar como presentación para la tele (en iPhone, con la ayuda de "Duplicar pantalla"). */
  present?: boolean;
};

export function openViewer(items: MediaItem[], index: number, { onDeleted, present }: ViewerOptions = {}) {
  const list = items.map((m) => ({ ...m }));
  const pswp = new PhotoSwipe({
    dataSource: list.map((m) => ({
      src: m.kind === "photo" ? (m.previewUrl ?? m.thumbUrl ?? undefined) : undefined,
      msrc: m.thumbUrl ?? undefined,
      width: m.width ?? 1600,
      height: m.height ?? 1200,
      alt: m.originalName,
    })),
    index,
    bgOpacity: 1,
    showHideAnimationType: "fade",
    // La foto entra entre la barra de arriba y la de botones, sin que ninguna la tape.
    paddingFn: () => ({
      top: TOP_BAR_PX,
      bottom: pswp.element?.querySelector<HTMLElement>(".pswp__actions")?.offsetHeight ?? 96,
      left: 0,
      right: 0,
    }),
    closeTitle: t.close,
    arrowPrevTitle: t.cast.prev,
    arrowNextTitle: t.cast.next,
  });

  pswp.on("contentLoad", (e) => {
    const m = list[e.content.index];
    if (!m || (m.kind === "photo" && (m.previewUrl || m.thumbUrl))) return;
    e.preventDefault();
    const box = document.createElement("div");
    box.className = "pswp-video";
    if (m.kind === "video" && m.videoUrl) {
      const v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = m.videoUrl;
      v.setAttribute("x-webkit-airplay", "allow");
      if (m.posterUrl) v.poster = m.posterUrl;
      box.append(v);
    } else {
      box.textContent = m.kind === "video" ? t.viewer.videoPreparing : t.gallery.processing;
    }
    e.content.element = box;
    e.content.state = "loaded";
  });
  pswp.on("change", () => {
    for (const v of document.querySelectorAll<HTMLVideoElement>(".pswp video")) v.pause();
  });

  // Presentación: las fotos pasan cada SLIDE_MS; un video se ve entero y después sigue.
  const currentVideo = () => pswp.currSlide?.content.element?.querySelector<AirPlayVideo>("video") ?? null;
  let presenting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let showPresenting = () => {};
  const schedule = () => {
    clearTimeout(timer);
    if (!presenting) return;
    const v = currentVideo();
    if (v) {
      v.onended = () => presenting && pswp.next();
      v.play().catch(() => {
        timer = setTimeout(() => pswp.next(), SLIDE_MS);
      });
    } else timer = setTimeout(() => pswp.next(), SLIDE_MS);
  };
  // Duplicando la pantalla, si el celu se apaga la tele queda en negro: pantalla prendida mientras pasa.
  let wakeLock: WakeLockSentinel | null = null;
  const keepAwake = (on: boolean) => {
    if (on && !wakeLock)
      navigator.wakeLock?.request("screen").then(
        (l) => {
          wakeLock = l;
        },
        () => {},
      );
    if (!on) {
      wakeLock?.release().catch(() => {});
      wakeLock = null;
    }
  };
  const setPresenting = (on: boolean) => {
    presenting = on;
    keepAwake(on);
    // Sin botones encima mientras pasa (tocar la pantalla los vuelve a mostrar).
    pswp.element?.classList.toggle("pswp--ui-visible", !on);
    showPresenting();
    schedule();
  };
  pswp.on("change", schedule);
  pswp.on("destroy", () => {
    clearTimeout(timer);
    keepAwake(false);
  });

  pswp.on("uiRegister", () => {
    pswp.ui?.registerElement({
      name: "actions",
      appendTo: "root",
      onInit: (el) => {
        el.className = "pswp__actions";
        const dl = action("a", iconSvg("download"), t.viewer.downloadShort, t.viewer.download);
        dl.setAttribute("download", "");
        const fav = action("button", iconSvg("heart"), t.viewer.favoriteShort);
        const cast = action("button", iconSvg("tv"), t.viewer.castShort, t.viewer.cast);
        const del = action("button", iconSvg("trash"), t.viewer.delete);
        // Siempre: sin Chromecast queda duplicar la pantalla o la presentación (Samsung, LG, el navegador de la tele).
        el.append(dl, fav, cast, del);
        showPresenting = () => {
          cast.innerHTML = `${iconSvg("tv")}<span>${presenting ? t.viewer.stopShow : t.viewer.castShort}</span>`;
          cast.setAttribute("aria-label", presenting ? t.viewer.stopShow : t.viewer.cast);
        };

        const current = () => list[pswp.currIndex];
        const sync = () => {
          const m = current();
          if (!m) return;
          dl.href = m.originalUrl;
          fav.setAttribute("aria-pressed", String(m.favorite));
          fav.setAttribute("aria-label", m.favorite ? t.viewer.unfavorite : t.viewer.favorite);
        };
        pswp.on("change", sync);
        sync();
        fav.onclick = async () => {
          const m = current();
          if (!m) return;
          m.favorite = !m.favorite;
          sync();
          try {
            if (m.favorite) await api.post(endpoints.mediaFavorite(m.id), {});
            else await api.del(endpoints.mediaFavorite(m.id));
          } catch {
            m.favorite = !m.favorite;
            sync();
          }
        };
        cast.onclick = () => {
          if (presenting) return setPresenting(false);
          const p = platform();
          // Con un Chromecast a la vista, va por Cast.
          if (p !== "ios" && castState.get().devices) return castItems(list, pswp.currIndex);
          // En iPhone un video va directo por AirPlay; las fotos, duplicando la pantalla.
          const v = currentVideo();
          if (p === "ios" && current()?.kind === "video" && v?.webkitShowPlaybackTargetPicker)
            return v.webkitShowPlaybackTargetPicker();
          startShow(p);
        };
        del.onclick = () => {
          const m = current();
          if (m)
            confirmDelete(pswp.element, m, () => {
              pswp.close();
              onDeleted?.();
            });
        };
      },
    });
  });
  pswp.init();
  /** iPhone y Android: primero cómo duplicar la pantalla; la tele y la compu arrancan directo. */
  function startShow(p: Platform) {
    if (p !== "ios" && p !== "android") return setPresenting(true);
    const cast = p === "android" && castState.get().available ? () => castItems(list, pswp.currIndex) : undefined;
    mirrorHelp(pswp.element, p, () => setPresenting(true), cast);
  }
  if (present) startShow(platform());
  return pswp;
}

/** Cómo duplicar la pantalla del celu en la tele (AirPlay en iPhone, Smart View y parecidos en Android). */
function mirrorHelp(root: HTMLElement | undefined, kind: "ios" | "android", start: () => void, cast?: () => void) {
  const texts = t.viewer.mirror[kind];
  const d = document.createElement("dialog");
  d.setAttribute("aria-labelledby", "viewer-mirror-title");
  const box = document.createElement("div");
  box.className = "stack";
  const title = document.createElement("h2");
  title.id = "viewer-mirror-title";
  title.textContent = texts.title;
  const steps = document.createElement("ol");
  steps.className = "steps";
  for (const s of texts.steps) {
    const li = document.createElement("li");
    li.textContent = s;
    steps.append(li);
  }
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = texts.note;
  const button = (label: string, cls: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.onclick = () => {
      d.close();
      onClick();
    };
    return b;
  };
  box.append(title, steps, note, button(t.viewer.startShow, "btn primary", start));
  if (cast) box.append(button(t.viewer.findChromecast, "btn", cast));
  box.append(button(t.cancel, "btn", () => {}));
  d.append(box);
  (root ?? document.body).append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
}

/** Diálogo de confirmación (dentro del visor, para que PhotoSwipe no le robe el foco). Nada se borra sin el «Sí». */
function confirmDelete(root: HTMLElement | undefined, m: MediaItem, done: () => void) {
  const d = document.createElement("dialog");
  d.setAttribute("aria-labelledby", "viewer-del-title");
  const box = document.createElement("div");
  box.className = "stack";
  const title = document.createElement("h2");
  title.id = "viewer-del-title";
  title.textContent = m.kind === "video" ? t.viewer.deleteVideoTitle : t.viewer.deleteTitle;
  const body = document.createElement("p");
  body.textContent = t.viewer.deleteBody;
  const err = document.createElement("p");
  err.className = "error";
  err.setAttribute("role", "alert");
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "btn danger primary";
  yes.textContent = t.viewer.deleteConfirm;
  const no = document.createElement("button");
  no.type = "button";
  no.className = "btn";
  no.textContent = t.cancel;
  if (m.thumbUrl) {
    const img = document.createElement("img");
    img.src = m.thumbUrl;
    img.alt = "";
    img.className = "dialog-thumb";
    box.append(img);
  }
  box.prepend(title);
  box.append(body, err, yes, no);
  d.append(box);
  (root ?? document.body).append(d);
  d.addEventListener("close", () => d.remove());
  no.onclick = () => d.close();
  yes.onclick = async () => {
    yes.disabled = true;
    try {
      await api.del(endpoints.mediaItem(m.id));
      d.close();
      done();
    } catch (e) {
      err.textContent = errorText(e);
      yes.disabled = false;
    }
  };
  d.showModal();
}

// Visor PhotoSwipe 5: swipe, pantalla completa, video, "Descargar original", favorita, tele y borrar.
// En iPhone la tele va por AirPlay: los videos con el selector de AirPlay y las fotos con una presentación
// que pasa sola, para verla con "Duplicar pantalla".
import "photoswipe/style.css";
import { endpoints, type MediaItem } from "@lfg/shared";
import PhotoSwipe from "photoswipe";
import { api, errorText } from "../api/client";
import { castItems, castState, isIOS, SLIDE_MS } from "../cast";
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
  const setPresenting = (on: boolean) => {
    presenting = on;
    // Sin botones encima mientras pasa (tocar la pantalla los vuelve a mostrar).
    pswp.element?.classList.toggle("pswp--ui-visible", !on);
    showPresenting();
    schedule();
  };
  pswp.on("change", schedule);
  pswp.on("destroy", () => clearTimeout(timer));

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
        const ios = isIOS();
        el.append(dl, fav);
        if (castState.get().available || ios) el.append(cast);
        el.append(del);
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
          if (!ios) return castItems(list, pswp.currIndex);
          if (presenting) return setPresenting(false);
          // Un video va directo por AirPlay; las fotos, con "Duplicar pantalla" y la presentación.
          const v = currentVideo();
          if (current()?.kind === "video" && v?.webkitShowPlaybackTargetPicker)
            return v.webkitShowPlaybackTargetPicker();
          airplayHelp(pswp.element, () => setPresenting(true));
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
  if (present) {
    if (isIOS()) airplayHelp(pswp.element, () => setPresenting(true));
    else setPresenting(true);
  }
  return pswp;
}

/** Cómo ver fotos en la tele desde iPhone: Duplicar pantalla (AirPlay) y después la presentación. */
function airplayHelp(root: HTMLElement | undefined, start: () => void) {
  const d = document.createElement("dialog");
  d.setAttribute("aria-labelledby", "viewer-airplay-title");
  const box = document.createElement("div");
  box.className = "stack";
  const title = document.createElement("h2");
  title.id = "viewer-airplay-title";
  title.textContent = t.viewer.airplayTitle;
  const steps = document.createElement("ol");
  steps.className = "steps";
  for (const s of t.viewer.airplaySteps) {
    const li = document.createElement("li");
    li.textContent = s;
    steps.append(li);
  }
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = t.viewer.airplayNote;
  const go = document.createElement("button");
  go.type = "button";
  go.className = "btn primary";
  go.textContent = t.viewer.startShow;
  const no = document.createElement("button");
  no.type = "button";
  no.className = "btn";
  no.textContent = t.cancel;
  box.append(title, steps, note, go, no);
  d.append(box);
  (root ?? document.body).append(d);
  d.addEventListener("close", () => d.remove());
  no.onclick = () => d.close();
  go.onclick = () => {
    d.close();
    start();
  };
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

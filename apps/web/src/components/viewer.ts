// Visor PhotoSwipe 5: swipe, pantalla completa, video, "Descargar original", favorita, tele y borrar.
// "Tele": Chromecast si hay uno; en iPhone, un video va por AirPlay; si no, la presentación para la tele (tvshow).
import "photoswipe/style.css";
import { endpoints, type MediaItem } from "@lfg/shared";
import PhotoSwipe from "photoswipe";
import { api, errorText } from "../api/client";
import { castItems, castState, platform } from "../cast";
import { t } from "../i18n";
import { iconSvg } from "./icons";
import { startTvShow } from "./tvshow";

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
};

export function openViewer(items: MediaItem[], index: number, { onDeleted }: ViewerOptions = {}) {
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

  const currentVideo = () => pswp.currSlide?.content.element?.querySelector<AirPlayVideo>("video") ?? null;

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
          const p = platform();
          // Con un Chromecast a la vista, va por Cast.
          if (p !== "ios" && castState.get().devices) return castItems(list, pswp.currIndex);
          // En iPhone un video va directo por AirPlay; las fotos, duplicando la pantalla.
          const v = currentVideo();
          if (p === "ios" && current()?.kind === "video" && v?.webkitShowPlaybackTargetPicker)
            return v.webkitShowPlaybackTargetPicker();
          startTvShow(list, pswp.currIndex, pswp.element, () => pswp.close());
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
  return pswp;
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

// Visor PhotoSwipe 5: swipe, pantalla completa, video, "Descargar original", favorita, tele y borrar.
import "photoswipe/style.css";
import { endpoints, type MediaItem } from "@lfg/shared";
import PhotoSwipe from "photoswipe";
import { api, errorText } from "../api/client";
import { castItems, castState } from "../cast";
import { t } from "../i18n";

const TRASH = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z"/></svg>`;
const HEART = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4 6.4 4 8.6 4 10.4 5.3 12 7.2 13.6 5.3 15.4 4 17.6 4 21.7 4 23.6 8.4 22 11.7 19.5 16.4 12 21 12 21z"/></svg>`;

/** `onDeleted`: alguien borró la foto que estaba viendo; el visor se cierra y la pantalla recarga. */
export function openViewer(
  items: MediaItem[],
  index: number,
  onChange?: (m: MediaItem) => void,
  onDeleted?: () => void,
) {
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

  pswp.on("uiRegister", () => {
    pswp.ui?.registerElement({
      name: "actions",
      appendTo: "root",
      onInit: (el) => {
        el.className = "pswp__actions";
        const dl = document.createElement("a");
        dl.className = "btn";
        dl.textContent = t.viewer.download;
        dl.setAttribute("download", "");
        const fav = document.createElement("button");
        fav.type = "button";
        fav.className = "btn icon";
        fav.innerHTML = HEART;
        const cast = document.createElement("button");
        cast.type = "button";
        cast.className = "btn";
        cast.textContent = t.viewer.cast;
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn icon";
        del.innerHTML = TRASH;
        del.setAttribute("aria-label", t.viewer.delete);
        el.append(dl, fav);
        if (castState.get().available) el.append(cast);
        el.append(del);

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
            onChange?.({ ...m });
          } catch {
            m.favorite = !m.favorite;
            sync();
          }
        };
        cast.onclick = () => castItems(list, pswp.currIndex);
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

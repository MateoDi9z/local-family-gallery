// Presentación para la tele: la vista que se ve al duplicar la pantalla del celu (Smart View, AirPlay) o en el
// navegador de la tele. Pantalla completa, fondo negro, cada foto o video lo más grande posible sin recortarse,
// y en Android gira sola a horizontal para que un video llene la tele. Las fotos pasan solas; los videos, enteros.
import type { MediaItem } from "@lfg/shared";
import { castItems, castState, platform, SLIDE_MS } from "../cast";
import { t } from "../i18n";
import { type IconName, iconSvg } from "./icons";

/** Los controles se esconden solos para que en la tele se vea solo la foto. */
const CONTROLS_MS = 3000;
const HINT_MS = 5000;
const SWIPE_PX = 50;
/** Tecla "volver" del control remoto de las Samsung (Tizen). */
const TIZEN_BACK = 10009;

type Lockable = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

/**
 * Empieza la presentación. En el celu primero explica cómo duplicar la pantalla (y en Android ofrece buscar un
 * Chromecast); en la tele o en una compu arranca directo. Llamar desde un toque: pantalla completa lo exige.
 */
export function startTvShow(items: MediaItem[], index = 0, root?: HTMLElement, beforeOpen?: () => void) {
  const p = platform();
  const open = () => {
    beforeOpen?.();
    openTvShow(items, index);
  };
  if (p !== "ios" && p !== "android") return open();
  const cast =
    p === "android" && castState.get().available
      ? () => {
          beforeOpen?.();
          castItems(items, index, true);
        }
      : undefined;
  mirrorHelp(root, p, open, cast);
}

export function openTvShow(items: MediaItem[], start = 0) {
  if (items.length === 0) return;
  const n = items.length;
  let index = Math.max(0, Math.min(start, n - 1));
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeLock: WakeLockSentinel | null = null;

  const root = document.createElement("div");
  root.className = "tvshow";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", t.tvshow.label);
  // Dos capas para pasar de una a otra con un fundido.
  const layers = [document.createElement("div"), document.createElement("div")];
  for (const l of layers) l.className = "tvshow-slide";
  let front = 0;
  const hint = document.createElement("p");
  hint.className = "tvshow-hint";
  const counter = document.createElement("span");
  counter.className = "tvshow-counter";
  const controls = document.createElement("div");
  controls.className = "tvshow-controls";
  const button = (icon: IconName, label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.innerHTML = `${iconSvg(icon, 30)}<span>${label}</span>`;
    b.setAttribute("aria-label", label);
    b.onclick = (e) => {
      e.stopPropagation();
      onClick();
      showControls();
    };
    return b;
  };
  const prevBtn = button("prev", t.tvshow.prev, () => go(-1));
  const pauseBtn = button("pause", t.tvshow.pause, () => togglePause());
  const nextBtn = button("next", t.tvshow.next, () => go(1));
  const exitBtn = button("close", t.tvshow.exit, () => close());
  controls.append(prevBtn, pauseBtn, nextBtn, exitBtn, counter);
  root.append(...layers, hint, controls);
  document.body.append(root);

  const syncPause = () => {
    pauseBtn.innerHTML = `${iconSvg(paused ? "play" : "pause", 30)}<span>${paused ? t.tvshow.play : t.tvshow.pause}</span>`;
    pauseBtn.setAttribute("aria-label", paused ? t.tvshow.play : t.tvshow.pause);
  };
  const showControls = () => {
    root.classList.add("ui");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => root.classList.remove("ui"), CONTROLS_MS);
  };
  const flash = (text: string) => {
    hint.textContent = text;
    hint.classList.add("on");
    setTimeout(() => hint.classList.remove("on"), HINT_MS);
  };

  const currentVideo = () => layers[front]?.querySelector("video") ?? null;
  const schedule = () => {
    clearTimeout(timer);
    if (paused) return;
    const v = currentVideo();
    // Un video se ve entero; si el celu no deja reproducirlo solo, sigue con el tiempo de una foto.
    if (v) v.play().catch(() => (timer = setTimeout(() => go(1), SLIDE_MS)));
    else timer = setTimeout(() => go(1), SLIDE_MS);
  };
  const show = (i: number) => {
    index = (i + n) % n;
    const m = items[index] as MediaItem;
    const back = 1 - front;
    const layer = layers[back] as HTMLDivElement;
    layer.replaceChildren();
    if (m.kind === "video" && m.videoUrl) {
      const v = document.createElement("video");
      v.src = m.videoUrl;
      v.playsInline = true;
      v.preload = "auto";
      v.setAttribute("x-webkit-airplay", "allow");
      if (m.posterUrl) v.poster = m.posterUrl;
      v.onended = () => !paused && go(1);
      layer.append(v);
    } else {
      const src = m.kind === "video" ? m.posterUrl : (m.previewUrl ?? m.thumbUrl);
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = m.originalName;
        layer.append(img);
      }
      if (m.kind === "video") {
        const note = document.createElement("p");
        note.className = "tvshow-note";
        note.textContent = t.viewer.videoPreparing;
        layer.append(note);
      }
    }
    // La anterior se apaga con un fundido y deja de sonar.
    const old = layers[front] as HTMLDivElement;
    for (const v of old.querySelectorAll("video")) v.pause();
    layer.classList.add("on");
    old.classList.remove("on");
    front = back;
    counter.textContent = `${index + 1} / ${n}`;
    // Que la próxima foto ya esté bajada cuando le toque.
    const next = items[(index + 1) % n];
    if (next?.kind === "photo" && next.previewUrl) new Image().src = next.previewUrl;
    schedule();
  };
  const go = (d: number) => show(index + d);
  const togglePause = () => {
    paused = !paused;
    const v = currentVideo();
    if (v && paused) v.pause();
    syncPause();
    schedule();
  };

  // Teclado y control remoto (en el navegador de la tele): flechas, OK, volver.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "Enter" || e.key === " ") togglePause();
    else if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack" || e.keyCode === TIZEN_BACK) close();
    else return;
    e.preventDefault();
    showControls();
  };
  let touchX: number | null = null;
  root.addEventListener("touchstart", (e) => {
    touchX = e.touches[0]?.clientX ?? null;
  });
  root.addEventListener("touchend", (e) => {
    const x = e.changedTouches[0]?.clientX;
    if (touchX !== null && x !== undefined && Math.abs(x - touchX) > SWIPE_PX) go(x < touchX ? 1 : -1);
    touchX = null;
  });
  root.addEventListener("click", showControls);
  root.addEventListener("mousemove", showControls);
  window.addEventListener("keydown", onKey);

  // Lo más grande posible: pantalla completa y, si se puede, horizontal (en Android gira solo).
  const orientation = screen.orientation as Lockable | undefined;
  const portrait = () => matchMedia("(orientation: portrait)").matches;
  const enter = root.requestFullscreen?.({ navigationUI: "hide" });
  Promise.resolve(enter)
    .then(() => orientation?.lock?.("landscape"))
    .catch(() => {})
    .finally(() => {
      if (portrait() && platform() !== "tv") flash(t.tvshow.rotate);
    });
  // Duplicando la pantalla, si el celu se apaga la tele queda en negro.
  navigator.wakeLock?.request("screen").then(
    (l) => {
      wakeLock = l;
    },
    () => {},
  );

  function close() {
    clearTimeout(timer);
    clearTimeout(hideTimer);
    window.removeEventListener("keydown", onKey);
    for (const v of root.querySelectorAll("video")) v.pause();
    wakeLock?.release().catch(() => {});
    orientation?.unlock?.();
    if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    root.remove();
  }

  syncPause();
  show(index);
  showControls();
  return close;
}

/** Cómo duplicar la pantalla del celu en la tele (AirPlay en iPhone, Smart View y parecidos en Android). */
export function mirrorHelp(
  root: HTMLElement | undefined,
  kind: "ios" | "android",
  start: () => void,
  cast?: () => void,
) {
  const texts = t.viewer.mirror[kind];
  const d = document.createElement("dialog");
  d.setAttribute("aria-labelledby", "mirror-title");
  const box = document.createElement("div");
  box.className = "stack";
  const title = document.createElement("h2");
  title.id = "mirror-title";
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

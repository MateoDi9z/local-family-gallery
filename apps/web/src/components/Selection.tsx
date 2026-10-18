// Elegir varias fotos de la grilla y descargarlas, compartirlas o borrarlas juntas.
// Compartir manda los originales con la hoja de compartir del celu (en iPhone, "Guardar imágenes" las pasa a
// Fotos). Se preparan primero y se comparten con un segundo toque: Safari exige que share() salga de un toque.
import { DeletedCount, endpoints, type MediaItem } from "@lfg/shared";
import { type ReactNode, useRef, useState } from "react";
import { api, errorText } from "../api/client";
import { isIOS } from "../cast";
import { t } from "../i18n";
import { Icon, type IconName } from "./icons";

/** Tope de lo que se junta en memoria para compartir (videos largos pesan mucho). */
const SHARE_MAX_BYTES = 300 * 1024 ** 2;

const canShareFiles = () => {
  try {
    return !!navigator.canShare?.({ files: [new File([""], "foto.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
};

/** Originales en el orden elegido; corta si se pasan del tope. */
async function originals(items: MediaItem[], onProgress: (n: number) => void): Promise<File[]> {
  const files: File[] = [];
  let bytes = 0;
  for (const m of items) {
    const res = await fetch(m.originalUrl, { credentials: "same-origin" });
    if (!res.ok) throw new Error(t.errors.generic);
    const blob = await res.blob();
    bytes += blob.size;
    if (bytes > SHARE_MAX_BYTES) throw new Error(t.select.tooBig);
    files.push(new File([blob], m.originalName, { type: blob.type || "application/octet-stream" }));
    onProgress(files.length);
  }
  return files;
}

/** De a uno, con un respiro: Chrome descarta descargas seguidas muy juntas. */
async function download(items: MediaItem[], onProgress: (n: number) => void) {
  for (const [i, m] of items.entries()) {
    const a = document.createElement("a");
    a.href = m.originalUrl;
    a.download = m.originalName;
    document.body.append(a);
    a.click();
    a.remove();
    onProgress(i + 1);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function Action({ icon, label, ...rest }: { icon: IconName; label: string } & React.ComponentProps<"button">) {
  return (
    <button type="button" className="btn" {...rest}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

/**
 * `items`: las que se ven (con el filtro de persona). `total`: todas las de la pantalla, para saber si al borrar
 * no quedó ninguna. Devuelve las props para `<Grid>`, el botón «Elegir» y la barra (va después de la grilla).
 */
export function useSelection(items: MediaItem[], total: number, onDeleted: (allGone: boolean) => void) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareFiles, setShareFiles] = useState<File[] | null>(null);
  const delDialog = useRef<HTMLDialogElement>(null);
  const shareDialog = useRef<HTMLDialogElement>(null);

  const chosen = () => items.filter((m) => selected.has(m.id));
  const stop = () => {
    setActive(false);
    setSelected(new Set());
    setStatus(null);
    setError(null);
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  /** Corre una acción larga mostrando el avance; los errores quedan en la barra o en el diálogo. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const onDownload = () =>
    run(async () => {
      const list = chosen();
      await download(list, (n) => setStatus(t.select.downloading(n, list.length)));
      setStatus(t.select.downloaded(list.length));
    });
  const onPrepareShare = () => {
    setShareFiles(null);
    setError(null);
    shareDialog.current?.showModal();
    run(async () => {
      const list = chosen();
      setShareFiles(await originals(list, (n) => setStatus(t.select.preparing(n, list.length))));
      setStatus(null);
    });
  };
  const onShare = async () => {
    if (!shareFiles) return;
    try {
      await navigator.share({ files: shareFiles });
      shareDialog.current?.close();
    } catch (e) {
      // Cerrar la hoja de compartir no es un error.
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(errorText(e));
    }
  };
  const onDelete = () =>
    run(async () => {
      const { deleted } = await api.post(endpoints.mediaDeleteBulk, { mediaIds: [...selected] }, DeletedCount);
      delDialog.current?.close();
      stop();
      onDeleted(deleted >= total);
    });

  const n = selected.size;
  const allSelected = n > 0 && n === items.length;
  const button: ReactNode = active ? null : (
    <Action
      icon="select"
      label={t.select.start}
      className="btn small"
      onClick={() => setActive(true)}
      disabled={items.length === 0}
    />
  );
  const bar: ReactNode = active && (
    <>
      {/* Lugar para que la barra fija no tape la última fila. */}
      <div className="select-spacer" aria-hidden="true" />
      <section className="card select-bar" aria-label={t.select.label}>
        <div className="select-head">
          <strong role="status">{status ?? t.select.count(n)}</strong>
          <button type="button" className="btn link" onClick={stop}>
            {t.cancel}
          </button>
        </div>
        {error && !shareDialog.current?.open && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="select-actions">
          <Action
            icon="select"
            label={allSelected ? t.select.none : t.select.all}
            onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((m) => m.id)))}
          />
          <Action icon="download" label={t.select.download} disabled={n === 0 || busy} onClick={onDownload} />
          {canShareFiles() && (
            <Action icon="share" label={t.select.share} disabled={n === 0 || busy} onClick={onPrepareShare} />
          )}
          <Action
            icon="trash"
            label={t.select.delete}
            className="btn danger"
            disabled={n === 0 || busy}
            onClick={() => delDialog.current?.showModal()}
          />
        </div>
      </section>
      <dialog ref={shareDialog} aria-labelledby="share-title">
        <div className="stack">
          <h2 id="share-title">{t.select.shareTitle(n)}</h2>
          <p role="status">{shareFiles ? t.select.shareReady(isIOS()) : (status ?? t.select.preparing(0, n))}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn primary" disabled={!shareFiles} onClick={onShare}>
            {t.select.share}
          </button>
          <button type="button" className="btn" onClick={() => shareDialog.current?.close()}>
            {t.cancel}
          </button>
        </div>
      </dialog>
      <dialog ref={delDialog} aria-labelledby="bulk-del-title">
        <div className="stack">
          <h2 id="bulk-del-title">{t.select.confirmTitle(n)}</h2>
          <p>{t.select.confirmBody}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn danger primary" disabled={busy} onClick={onDelete}>
            {busy ? t.select.busy : t.select.confirm(n)}
          </button>
          <button type="button" className="btn" onClick={() => delDialog.current?.close()}>
            {t.cancel}
          </button>
        </div>
      </dialog>
    </>
  );
  return { gridProps: active ? { selected, onToggle: toggle } : {}, button, bar };
}

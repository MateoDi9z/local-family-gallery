// Elegir varias fotos de la grilla y borrarlas juntas, con confirmación. Lo usan el lugar y el viaje.
import { DeletedCount, endpoints, type MediaItem } from "@lfg/shared";
import { useRef, useState } from "react";
import { api, errorText } from "../api/client";
import { t } from "../i18n";

/**
 * `items`: las que se ven (con el filtro de persona). `total`: todas las de la pantalla, para saber si
 * no quedó ninguna. Devuelve las props para `<Grid>`, el botón «Elegir fotos» y la barra (va después de la grilla).
 */
export function useBulkDelete(items: MediaItem[], total: number, onDeleted: (allGone: boolean) => void) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const stop = () => {
    setActive(false);
    setSelected(new Set());
    setError(null);
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const { deleted } = await api.post(endpoints.mediaDeleteBulk, { mediaIds: [...selected] }, DeletedCount);
      dialog.current?.close();
      stop();
      onDeleted(deleted >= total);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const n = selected.size;
  const allSelected = n > 0 && n === items.length;
  const button = active ? null : (
    <button type="button" className="btn" onClick={() => setActive(true)} disabled={items.length === 0}>
      {t.select.start}
    </button>
  );
  const bar = active && (
    <>
      {/* Lugar para que la barra fija no tape la última fila. */}
      <div className="select-spacer" aria-hidden="true" />
      <section className="card stack select-bar" aria-label={t.select.label}>
        <strong role="status">{t.select.count(n)}</strong>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((m) => m.id)))}
          >
            {allSelected ? t.select.none : t.select.all}
          </button>
          <button
            type="button"
            className="btn danger primary"
            disabled={n === 0}
            onClick={() => dialog.current?.showModal()}
          >
            {t.select.delete}
          </button>
          <button type="button" className="btn link" onClick={stop}>
            {t.cancel}
          </button>
        </div>
      </section>
      <dialog ref={dialog} aria-labelledby="bulk-del-title">
        <div className="stack">
          <h2 id="bulk-del-title">{t.select.confirmTitle(n)}</h2>
          <p>{t.select.confirmBody}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn danger primary" disabled={busy} onClick={confirm}>
            {busy ? t.select.busy : t.select.confirm(n)}
          </button>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            {t.cancel}
          </button>
        </div>
      </dialog>
    </>
  );
  return { gridProps: active ? { selected, onToggle: toggle } : {}, button, bar };
}

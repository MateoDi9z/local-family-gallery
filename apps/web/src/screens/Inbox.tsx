// Bandejas: fotos sin ubicación y fotos parecidas. Nada se borra solo: borrar pide confirmación.
import { endpoints, type MediaItem, NoLocationInbox, SimilarInbox } from "@lfg/shared";
import { useRef, useState } from "react";
import { api, errorText } from "../api/client";
import { useApi } from "../api/hooks";
import { LocationFixer } from "../components/LocationFixer";
import { openViewer } from "../components/viewer";
import { t } from "../i18n";
import { Link } from "../router";
import { Failure, Loading } from "./Galleries";

export function NoLocation() {
  const { data, error, reload } = useApi(endpoints.inboxNoLocation, NoLocationInbox);
  if (error) return <Failure text={error} />;
  if (!data) return <Loading />;
  return (
    <main className="screen stack">
      <Link href="/mas" className="btn link">
        {t.back}
      </Link>
      <h1>{t.inbox.noLocationTitle}</h1>
      {data.items.length === 0 ? (
        <p className="notice">{t.inbox.noLocationEmpty}</p>
      ) : (
        <LocationFixer items={data.items} onChanged={reload} />
      )}
    </main>
  );
}

export function Similar() {
  const { data, error, reload } = useApi(endpoints.inboxSimilar, SimilarInbox);
  const [actionError, setActionError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [toDelete, setToDelete] = useState<MediaItem | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(errorText(e));
    }
  };
  const askDelete = (m: MediaItem) => {
    setToDelete(m);
    dialog.current?.showModal();
  };
  const confirmDelete = () => {
    const m = toDelete;
    dialog.current?.close();
    if (m) act(() => api.del(endpoints.mediaItem(m.id)));
  };

  if (error) return <Failure text={error} />;
  if (!data) return <Loading />;
  return (
    <main className="screen stack">
      <Link href="/mas" className="btn link">
        {t.back}
      </Link>
      <h1>{t.inbox.similarTitle}</h1>
      <p className="muted">{t.inbox.similarHelp}</p>
      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}
      {data.items.length === 0 && <p className="notice">{t.inbox.similarEmpty}</p>}
      {data.items.map((p) => (
        <section key={p.id} className="card stack" data-testid="similar-pair">
          <div className="pair">
            {[p.a, p.b].map((m, i) => (
              <div key={m.id} className="stack">
                <button
                  type="button"
                  className="tile"
                  aria-label={`${i === 0 ? t.inbox.left : t.inbox.right}: ${m.originalName}`}
                  onClick={() => openViewer([p.a, p.b], i, undefined, reload)}
                >
                  {m.thumbUrl && <img src={m.thumbUrl} alt="" loading="lazy" />}
                </button>
                <button type="button" className="btn danger" onClick={() => askDelete(m)}>
                  {t.inbox.deleteThis}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={() => act(() => api.post(endpoints.inboxSimilarItem(p.id), { action: "kept_both" }))}
          >
            {t.inbox.keepBoth}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => act(() => api.post(endpoints.inboxSimilarItem(p.id), { action: "dismissed" }))}
          >
            {t.inbox.dismiss}
          </button>
        </section>
      ))}
      <dialog ref={dialog} aria-labelledby="del-title">
        <div className="stack">
          <h2 id="del-title">{t.inbox.confirmDeleteTitle}</h2>
          {toDelete?.thumbUrl && <img src={toDelete.thumbUrl} alt="" style={{ maxHeight: 200, borderRadius: 12 }} />}
          <p>{t.inbox.confirmDeleteBody}</p>
          <button type="button" className="btn danger primary" onClick={confirmDelete}>
            {t.inbox.confirmDelete}
          </button>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            {t.cancel}
          </button>
        </div>
      </dialog>
    </main>
  );
}

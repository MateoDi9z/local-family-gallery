// Subidas: lo que se sube desde este dispositivo, lo que el servidor todavía está procesando (y qué le falta a
// cada foto), lo que falló y los últimos lotes. Se actualiza en vivo mientras haya algo en curso.
import { ActivityResponse, endpoints, type MediaItem } from "@lfg/shared";
import { useEffect, useState } from "react";
import { api, errorText } from "../api/client";
import { useApi, useMembers } from "../api/hooks";
import { Icon } from "../components/icons";
import { useLiveReload } from "../components/useLiveReload";
import { formatAgo, t } from "../i18n";
import { Link } from "../router";
import { useStore } from "../store";
import { upload } from "../upload/uploader";
import { Failure, Loading } from "./Galleries";
import { UploadProgress } from "./Upload";

/** Sin nada en curso igual mira de vez en cuando, por si suben desde otro dispositivo. */
const IDLE_REFRESH_MS = 20_000;

function Thumb({ m }: { m: MediaItem }) {
  return m.thumbUrl ? (
    <img className="act-thumb" src={m.thumbUrl} alt="" loading="lazy" />
  ) : (
    <span className="act-thumb ph" aria-hidden="true">
      <Icon name={m.kind === "video" ? "video" : "photo"} size={22} />
    </span>
  );
}

export function Activity() {
  const { data, error, reload } = useApi(endpoints.activity, ActivityResponse);
  const up = useStore(upload);
  const members = useMembers();
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const uploading = up.phase === "preparing" || up.phase === "uploading";
  const busy = uploading || (data?.processingTotal ?? 0) > 0;
  useLiveReload(busy, reload);
  useEffect(() => {
    if (busy) return;
    const id = setInterval(reload, IDLE_REFRESH_MS);
    return () => clearInterval(id);
  }, [busy, reload]);
  // Cada archivo que termina de subir aparece enseguida en "Procesándose".
  // biome-ignore lint/correctness/useExhaustiveDependencies: up.done y up.phase marcan cuándo recargar.
  useEffect(reload, [up.done, up.phase]);

  if (error) return <Failure text={error} />;
  if (!data) return <Loading />;
  const retry = async () => {
    try {
      await api.post(endpoints.adminRetryFailed, {});
      setRetryMsg(t.activity.retried);
      reload();
    } catch (e) {
      setRetryMsg(errorText(e));
    }
  };
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "";

  return (
    <main className="screen stack">
      <h1>{t.activity.title}</h1>
      <UploadProgress />

      <section className="card stack">
        <h2>{t.activity.processing}</h2>
        {data.processingTotal === 0 ? (
          <p className="muted">{t.activity.allReady}</p>
        ) : (
          <>
            <p role="status">{t.activity.processingCount(data.processingTotal)}</p>
            <ul className="activity-list">
              {data.processing.map(({ media, steps, running }) => (
                <li key={media.id} className="act-row">
                  <Thumb m={media} />
                  <span className="act-text">
                    <strong>{running && steps[0] ? t.activity.steps[steps[0]] : t.activity.waiting}</strong>
                    <span className="muted act-name">{media.originalName}</span>
                  </span>
                </li>
              ))}
            </ul>
            {data.processingTotal > data.processing.length && (
              <p className="muted">{t.activity.more(data.processingTotal - data.processing.length)}</p>
            )}
          </>
        )}
        {data.failed.length > 0 && (
          <>
            <h2>{t.activity.failed}</h2>
            <ul className="activity-list">
              {data.failed.map((m) => (
                <li key={m.id} className="act-row">
                  <Thumb m={m} />
                  <span className="act-text">
                    <strong className="error">{t.activity.failedItem}</strong>
                    <span className="muted act-name">{m.originalName}</span>
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn primary" onClick={retry}>
              {t.activity.retry}
            </button>
          </>
        )}
        {retryMsg && <p role="status">{retryMsg}</p>}
      </section>

      <h2>{t.activity.recent}</h2>
      {data.batches.length === 0 && <p className="notice">{t.activity.noRecent}</p>}
      {data.batches.map((b) => (
        <Link key={b.batchId} href={`/lote/${encodeURIComponent(b.batchId)}`} className="card batch-card">
          <span className="batch-head">
            <strong>{name(b.memberId)}</strong>
            <span className="muted">
              {formatAgo(b.createdAt)} · {t.gallery.count(b.total)} · {t.activity.source[b.source]}
            </span>
          </span>
          {b.processing > 0 && <span className="muted">{t.activity.batchProcessing(b.processing)}</span>}
          <span className="batch-thumbs">
            {b.items.map((m) => (
              <Thumb key={m.id} m={m} />
            ))}
            {b.total > b.items.length && <span className="act-thumb more">+{b.total - b.items.length}</span>}
          </span>
        </Link>
      ))}
    </main>
  );
}

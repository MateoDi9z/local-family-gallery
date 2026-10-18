import { type DragEvent, useRef, useState } from "react";
import { t } from "../i18n";
import { Link } from "../router";
import { useStore } from "../store";
import { filesFromDrop, isMedia } from "../upload/files";
import { resetUpload, retryFailed, startUpload, upload } from "../upload/uploader";

const isTouch = () => matchMedia("(pointer: coarse)").matches;
const isMac = () => /Macintosh/.test(navigator.userAgent) && !isTouch() && navigator.maxTouchPoints < 2;

export function Upload() {
  const s = useStore(upload);
  const [drag, setDrag] = useState(false);
  const [noMedia, setNoMedia] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const busy = s.phase === "preparing" || s.phase === "uploading";

  const go = (files: File[], source: "web" | "desktop") => {
    const media = files.filter(isMedia);
    setNoMedia(media.length === 0);
    if (media.length) startUpload(media, source);
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (!busy) go(await filesFromDrop(e.dataTransfer), "desktop");
  };

  return (
    <main className="screen stack">
      <h1>{t.upload.title}</h1>
      <Link href="/subidas" className="btn link">
        {t.activity.open}
      </Link>
      {!busy && (
        <>
          <button type="button" className="btn primary big" onClick={() => input.current?.click()}>
            {t.upload.pick}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif,.mov"
            hidden
            data-testid="file-input"
            onChange={(e) => {
              go([...(e.target.files ?? [])], isTouch() ? "web" : "desktop");
              e.target.value = "";
            }}
          />
          {!isTouch() && (
            <>
              <button type="button" className="btn" onClick={() => folder.current?.click()}>
                {t.upload.pickFolder}
              </button>
              <input
                ref={folder}
                type="file"
                hidden
                {...{ webkitdirectory: "" }}
                onChange={(e) => {
                  go([...(e.target.files ?? [])], "desktop");
                  e.target.value = "";
                }}
              />
              {/* biome-ignore lint/a11y/noStaticElementInteractions: zona de arrastre; los botones de arriba son la vía accesible. */}
              <div
                className={`dropzone${drag ? " active" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
              >
                {drag ? t.upload.dropActive : t.upload.drop}
              </div>
            </>
          )}
          {isMac() && (
            <div className="notice">
              <strong>{t.upload.macTitle}</strong>
              <p>{t.upload.macHelp}</p>
            </div>
          )}
        </>
      )}
      {noMedia && <p className="error">{t.upload.noMedia}</p>}
      <UploadProgress />
      {s.error && (
        <p className="error" role="alert">
          {s.error}
        </p>
      )}
      {s.phase === "done" && (
        <div className="card stack" role="status">
          <p className="big-number">{s.done > 0 ? t.upload.finished : t.upload.allExisted}</p>
          {s.skipped > 0 && s.done > 0 && <p>{t.upload.skipped(s.skipped)}</p>}
          {s.batchId && s.done > 0 && (
            <Link className="btn primary big" href={`/lote/${s.batchId}`}>
              {t.upload.seeSummary}
            </Link>
          )}
          <button type="button" className="btn" onClick={resetUpload}>
            {t.upload.another}
          </button>
        </div>
      )}
    </main>
  );
}

export function UploadProgress() {
  const s = useStore(upload);
  if (s.phase === "preparing")
    return (
      <div className="card stack" role="status">
        <p className="big-number">{t.upload.preparing(s.prepared, s.total)}</p>
        <div className="progress">
          <div style={{ width: `${(100 * s.prepared) / Math.max(1, s.total)}%` }} />
        </div>
      </div>
    );
  if (s.phase !== "uploading") return null;
  const pct = (100 * s.bytesDone) / Math.max(1, s.bytesTotal);
  return (
    <div className="card stack">
      <p className="big-number" role="status" data-testid="upload-progress">
        {t.upload.uploading(Math.min(s.done + 1, s.total), s.total)}
      </p>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${pct}%` }} />
      </div>
      {s.skipped > 0 && <p className="muted">{t.upload.skipped(s.skipped)}</p>}
      {s.offline ? <p className="notice">{t.upload.offline}</p> : <p className="muted">{t.upload.keepOpen}</p>}
      {s.failed > 0 && (
        <div className="row">
          <p className="error">{t.upload.failed(s.failed)}</p>
          <button type="button" className="btn primary" onClick={retryFailed}>
            {t.upload.retryFailed}
          </button>
        </div>
      )}
    </div>
  );
}

/** Aviso chico en las otras pantallas mientras se sube. */
export function UploadPill() {
  const s = useStore(upload);
  if (s.phase !== "uploading" && s.phase !== "preparing") return null;
  return (
    <Link href="/subidas" className="btn primary upload-pill">
      {s.phase === "preparing" ? t.upload.preparing(s.prepared, s.total) : t.upload.inProgress(s.done, s.total)}
    </Link>
  );
}

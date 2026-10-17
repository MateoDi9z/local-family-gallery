import { castState, next, prev, stopCast, togglePause } from "../cast";
import { t } from "../i18n";
import { useStore } from "../store";

/** El celu como control remoto mientras hay algo en la tele. */
export function CastPanel() {
  const s = useStore(castState);
  if (!s.connected || s.total === 0) return null;
  return (
    <section className="card stack cast-panel" aria-label={t.cast.connected(s.device)}>
      <strong>
        {t.cast.connected(s.device)} · {s.index + 1} / {s.total}
      </strong>
      <div className="row">
        <button type="button" className="btn" onClick={prev}>
          {t.cast.prev}
        </button>
        <button type="button" className="btn primary" onClick={togglePause}>
          {s.paused ? t.cast.play : t.cast.pause}
        </button>
        <button type="button" className="btn" onClick={next}>
          {t.cast.next}
        </button>
        <button type="button" className="btn link" onClick={stopCast}>
          {t.cast.stop}
        </button>
      </div>
    </section>
  );
}

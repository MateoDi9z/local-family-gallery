// Unir este viaje con otro que se detectó separado (quedan como uno), o separar uno que ya se unió.
import { endpoints, Trip, TripMergeResponse } from "@lfg/shared";
import { useRef, useState } from "react";
import { z } from "zod";
import { api, errorText } from "../api/client";
import { useApi } from "../api/hooks";
import { formatShortDate, t } from "../i18n";
import { Icon } from "./icons";

const Trips = z.array(Trip);
const dates = (x: Trip) => t.trips.dates(formatShortDate(x.startAt), formatShortDate(x.endAt));

/** `onDone(tripId)`: el viaje que quedó (puede ser otro id) para ir a verlo. */
export function MergeTrip({ trip, onDone }: { trip: Trip; onDone: (tripId: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"pick" | "confirm" | "split" | null>(null);
  const [other, setOther] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trips = useApi(mode === "pick" ? endpoints.trips : null, Trips);
  // Los más cercanos en fecha primero: casi siempre es el de antes o el de después.
  const gap = (x: Trip) => Math.abs(Date.parse(x.startAt) - Date.parse(trip.startAt));
  const others = (trips.data ?? []).filter((x) => x.id !== trip.id).sort((a, b) => gap(a) - gap(b));

  const open = (m: "pick" | "split") => {
    setMode(m);
    setOther(null);
    setError(null);
    dialog.current?.showModal();
  };
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      const id = await fn();
      dialog.current?.close();
      onDone(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const merge = (o: Trip) =>
    run(async () => (await api.post(endpoints.tripMerge(trip.id), { otherId: o.id }, TripMergeResponse)).tripId);
  const split = () =>
    run(async () => {
      await api.del(endpoints.tripMerge(trip.id));
      return trip.id;
    });

  return (
    <>
      <button type="button" className="btn small" onClick={() => open("pick")}>
        <Icon name="merge" />
        <span>{t.trips.merge}</span>
      </button>
      {trip.merged && (
        <button type="button" className="btn small" onClick={() => open("split")}>
          <Icon name="split" />
          <span>{t.trips.split}</span>
        </button>
      )}
      <dialog ref={dialog} aria-labelledby="merge-title" onClose={() => setMode(null)}>
        <div className="stack">
          {mode === "split" ? (
            <>
              <h2 id="merge-title">{t.trips.splitTitle}</h2>
              <p>{t.trips.splitBody}</p>
            </>
          ) : mode === "confirm" && other ? (
            <>
              <h2 id="merge-title">{t.trips.mergeConfirm(trip.name, other.name)}</h2>
              <p>{t.trips.mergeBody}</p>
            </>
          ) : (
            <>
              <h2 id="merge-title">{t.trips.mergeTitle}</h2>
              <p className="muted">{t.trips.mergeHelp}</p>
              {trips.error && <p className="error">{trips.error}</p>}
              {!trips.data && !trips.error && <p role="status">{t.loading}</p>}
              {trips.data && others.length === 0 && <p className="notice">{t.trips.noOthers}</p>}
              <div className="merge-list stack">
                {others.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="card trip-card trip-pick"
                    onClick={() => {
                      setOther(o);
                      setMode("confirm");
                    }}
                  >
                    {o.coverThumbUrl ? <img src={o.coverThumbUrl} alt="" loading="lazy" /> : <span className="ph" />}
                    <span>
                      <strong>{o.name}</strong>
                      <span className="muted">
                        {dates(o)} · {t.gallery.count(o.count)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {mode === "confirm" && other && (
            <button type="button" className="btn primary" disabled={busy} onClick={() => merge(other)}>
              {busy ? t.trips.merging : t.trips.mergeYes}
            </button>
          )}
          {mode === "split" && (
            <button type="button" className="btn primary" disabled={busy} onClick={split}>
              {busy ? t.trips.merging : t.trips.splitYes}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => (mode === "confirm" ? setMode("pick") : dialog.current?.close())}
          >
            {mode === "confirm" ? t.back : t.cancel}
          </button>
        </div>
      </dialog>
    </>
  );
}

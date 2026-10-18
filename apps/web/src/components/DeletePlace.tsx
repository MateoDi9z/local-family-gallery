// Borrar todas las fotos de un lugar. Es lo más grave que se puede hacer desde la app: hay que escribir
// el nombre del lugar, y el servidor lo vuelve a revisar.
import { endpoints, type Place, PlaceDeleteAllResponse, sameName } from "@lfg/shared";
import { useRef, useState } from "react";
import { api, errorText } from "../api/client";
import { t } from "../i18n";
import { navigate } from "../router";

export function DeletePlace({ place }: { place: Place }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    setTyped("");
    setError(null);
    dialog.current?.showModal();
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.placeDeleteAll(place.id), { confirmName: typed }, PlaceDeleteAllResponse);
      dialog.current?.close();
      navigate("/");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="danger-zone">
      <button type="button" className="btn danger" onClick={open}>
        {t.deletePlace.button}
      </button>
      <dialog ref={dialog} aria-labelledby="del-place-title">
        <div className="stack">
          <h2 id="del-place-title">{t.deletePlace.title(place.name)}</h2>
          <p>{t.deletePlace.body(place.count)}</p>
          <label htmlFor="del-place-name">
            {t.deletePlace.typeLabel} <strong>{place.name}</strong>
          </label>
          <input
            id="del-place-name"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn danger primary"
            disabled={busy || !sameName(typed, place.name)}
            onClick={confirm}
          >
            {busy ? t.deletePlace.busy : t.deletePlace.confirm(place.count)}
          </button>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            {t.cancel}
          </button>
        </div>
      </dialog>
    </section>
  );
}

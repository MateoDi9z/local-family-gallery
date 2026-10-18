// "Fueron: …" en el viaje; tocándolo se elige a mano quiénes fueron (o se vuelve a lo automático).
import { endpoints, Trip } from "@lfg/shared";
import { useRef, useState } from "react";
import { api, errorText } from "../api/client";
import { useMembers } from "../api/hooks";
import { t } from "../i18n";
import { Icon } from "./icons";
import { MemberDots } from "./MemberDots";

export function TripMembers({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const members = useMembers();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Los que fueron aunque hoy estén ocultos, y todos los que siguen en la galería.
  const choices = members.filter((m) => !m.archived || trip.memberIds.includes(m.id));
  const names = members.filter((m) => trip.memberIds.includes(m.id)).map((m) => m.name);

  const open = () => {
    setPicked(new Set(trip.memberIds));
    setError(null);
    dialog.current?.showModal();
  };
  const save = async (memberIds: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await api.put(endpoints.tripMembers(trip.id), { memberIds }, Trip);
      dialog.current?.close();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <button type="button" className="trip-members" onClick={open} aria-label={t.trips.editMembers}>
        <span className="muted">{t.trips.wentLabel}</span>
        <MemberDots ids={trip.memberIds} />
        <span className="trip-members-names">{names.length ? names.join(", ") : t.trips.nobody}</span>
        <span className="trip-members-edit">
          <Icon name="edit" size={18} />
        </span>
      </button>
      <dialog ref={dialog} aria-labelledby="members-title">
        <div className="stack">
          <h2 id="members-title">{t.trips.membersTitle}</h2>
          <p className="muted">{t.trips.membersHelp}</p>
          <fieldset className="chips wrap" style={{ border: 0, margin: 0 }}>
            <legend className="sr-only">{t.trips.membersTitle}</legend>
            {choices.map((m) => (
              <button
                key={m.id}
                type="button"
                className="chip"
                aria-pressed={picked.has(m.id)}
                onClick={() => toggle(m.id)}
              >
                <span className="swatch" style={{ background: m.color }} />
                {m.name}
              </button>
            ))}
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={busy || picked.size === 0}
            onClick={() => save([...picked])}
          >
            {t.save}
          </button>
          {trip.membersCustom && (
            <button type="button" className="btn" disabled={busy} onClick={() => save([])}>
              {t.trips.membersAuto}
            </button>
          )}
          <button type="button" className="btn link" onClick={() => dialog.current?.close()}>
            {t.cancel}
          </button>
        </div>
      </dialog>
    </>
  );
}

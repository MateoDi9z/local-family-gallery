// Fotos sin ubicación: confirmar sugerencias de a una o todas, o elegir un lugar en el mapa para
// las elegidas o para todas. Lo usan el resumen del lote y la bandeja "Sin ubicación".
import { endpoints, type LocationSuggestion, type MediaItem } from "@lfg/shared";
import { useState } from "react";
import { api, errorText } from "../api/client";
import { t } from "../i18n";
import { Tile } from "./Grid";
import { type LatLon, MapPicker } from "./MapPicker";

type Item = { media: MediaItem; suggestion: LocationSuggestion | null };

async function assign(ids: string[], at: LatLon) {
  if (ids.length === 1) await api.patch(endpoints.mediaLocation(ids[0] as string), at);
  else await api.post(endpoints.mediaLocationBulk, { mediaIds: ids, ...at });
}

export function LocationFixer({
  items,
  onChanged,
  quickPlace,
}: {
  items: Item[];
  onChanged: () => void;
  quickPlace?: { name: string; at: LatLon } | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [point, setPoint] = useState<LatLon | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      setMsg(t.summary.assigned);
      setSelected(new Set());
      setPicking(false);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const withSuggestion = items.filter((i) => i.suggestion);
  const confirmAll = () =>
    run(async () => {
      // Agrupadas por coordenada sugerida: una llamada por lugar.
      const by = new Map<string, { at: LatLon; ids: string[] }>();
      for (const { media, suggestion: s } of withSuggestion) {
        if (!s) continue;
        const k = `${s.lat},${s.lon}`;
        const g = by.get(k) ?? { at: { lat: s.lat, lon: s.lon }, ids: [] };
        g.ids.push(media.id);
        by.set(k, g);
      }
      for (const g of by.values()) await assign(g.ids, g.at);
    });
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const all = items.map((i) => i.media.id);

  return (
    <div className="stack">
      {msg && (
        <p className="notice" role="status">
          {msg}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {quickPlace && (
        <button type="button" className="btn primary big" onClick={() => run(() => assign(all, quickPlace.at))}>
          {t.summary.areFrom(quickPlace.name)}
        </button>
      )}
      {withSuggestion.length > 1 && (
        <button type="button" className="btn primary" onClick={confirmAll}>
          {t.summary.confirmAll}
        </button>
      )}
      {withSuggestion.map(({ media, suggestion }) => (
        <div key={media.id} className="row">
          <div style={{ width: 110 }}>
            <Tile m={media} pressed={selected.has(media.id)} onClick={() => toggle(media.id)} />
          </div>
          {suggestion && (
            <div className="stack" style={{ flex: 1 }}>
              <span>{t.summary.suggestion(suggestion.placeName)}</span>
              <button
                type="button"
                className="btn"
                onClick={() => run(() => assign([media.id], { lat: suggestion.lat, lon: suggestion.lon }))}
              >
                {t.summary.confirm}
              </button>
            </div>
          )}
        </div>
      ))}
      {/* Las que no tienen sugerencia, en grilla: se tocan para elegirlas. */}
      <div className="grid-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {items
          .filter((i) => !i.suggestion)
          .map(({ media }) => (
            <Tile key={media.id} m={media} pressed={selected.has(media.id)} onClick={() => toggle(media.id)} />
          ))}
      </div>
      {selected.size > 0 && <p>{t.summary.selected(selected.size)}</p>}
      {!picking ? (
        <button type="button" className="btn" onClick={() => setPicking(true)}>
          {t.summary.pickOnMap}
        </button>
      ) : (
        <>
          <p className="muted">{t.summary.mapHelp}</p>
          <MapPicker value={point} onChange={setPoint} label={t.summary.pickOnMap} />
          {selected.size > 0 && (
            <button
              type="button"
              className="btn primary"
              disabled={!point}
              onClick={() => point && run(() => assign([...selected], point))}
            >
              {t.summary.assignSelected}
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!point}
            onClick={() => point && run(() => assign(all, point))}
          >
            {t.summary.assignAll}
          </button>
        </>
      )}
    </div>
  );
}

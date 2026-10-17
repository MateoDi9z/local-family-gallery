// Mapa para elegir un punto tocando. El mapa se crea una sola vez; los props viajan por refs.
import { Marker, type Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { createMap } from "./map";

export type LatLon = { lat: number; lon: number };

export function MapPicker({
  value,
  onChange,
  label,
}: {
  value: LatLon | null;
  onChange: (v: LatLon) => void;
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ map: MlMap; marker: Marker } | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const initial = useRef(value);
  const [geoError, setGeoError] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const v = initial.current;
    const map = createMap(el.current, v ? [v.lon, v.lat] : [0, 20], v ? 10 : 1.2);
    const marker = new Marker({ color: "#b9420b" });
    if (v) marker.setLngLat([v.lon, v.lat]).addTo(map);
    map.on("click", (e) => {
      marker.setLngLat(e.lngLat).addTo(map);
      cb.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    api.current = { map, marker };
    return () => map.remove();
  }, []);

  const useHere = () =>
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const v = { lat: coords.latitude, lon: coords.longitude };
        if (api.current) {
          api.current.marker.setLngLat([v.lon, v.lat]).addTo(api.current.map);
          api.current.map.jumpTo({ center: [v.lon, v.lat], zoom: 12 });
        }
        setGeoError(false);
        cb.current(v);
      },
      () => setGeoError(true),
    );

  return (
    <div className="stack">
      <div ref={el} className="map" role="application" aria-label={label} data-testid="map-picker" />
      {"geolocation" in navigator && (
        <button type="button" className="btn" onClick={useHere}>
          {t.map.useHere}
        </button>
      )}
      {geoError && <p className="error">{t.map.geoError}</p>}
    </div>
  );
}

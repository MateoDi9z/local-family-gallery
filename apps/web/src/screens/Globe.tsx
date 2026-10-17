// Pantalla principal: globo con clusters. El mapa y los marcadores se manejan fuera de React
// (un solo render), para que ande fluido en un Android de gama media.
import { endpoints, Place } from "@lfg/shared";
import { type GeoJSONSource, Marker, type Map as MlMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { useApi } from "../api/hooks";
import { createMap } from "../components/map";
import { t } from "../i18n";
import { Link, navigate } from "../router";

const Places = z.array(Place);
type PlaceT = z.infer<typeof Place>;

function placeMarker(p: { id: string; name: string; count: number; thumb: string }) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "place-marker";
  el.setAttribute("aria-label", t.globe.placeCount(p.name, p.count));
  if (p.thumb) el.style.backgroundImage = `url("${encodeURI(p.thumb)}")`;
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = String(p.count);
  el.append(badge);
  el.onclick = (e) => {
    e.stopPropagation();
    navigate(`/lugar/${encodeURIComponent(p.id)}`);
  };
  return el;
}

function clusterMarker(total: number, onClick: () => void) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "cluster-marker";
  el.textContent = String(total);
  el.setAttribute("aria-label", t.globe.cluster(total));
  el.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return el;
}

function mountPlaces(map: MlMap, places: PlaceT[]) {
  map.addSource("places", {
    type: "geojson",
    cluster: true,
    clusterRadius: 60,
    clusterMaxZoom: 12,
    clusterProperties: { total: ["+", ["get", "count"]] },
    data: {
      type: "FeatureCollection",
      features: places.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { id: p.id, name: p.name, count: p.count, thumb: p.coverThumbUrl ?? "" },
      })),
    },
  });
  // Capa invisible: solo hace que el source se procese; lo visible son los marcadores HTML.
  map.addLayer({
    id: "places-hit",
    type: "circle",
    source: "places",
    paint: { "circle-radius": 0, "circle-opacity": 0 },
  });

  const shown = new Map<string, Marker>();
  const update = () => {
    if (!map.isSourceLoaded("places")) return;
    const keep = new Set<string>();
    for (const f of map.querySourceFeatures("places")) {
      const props = f.properties ?? {};
      const geom = f.geometry;
      if (geom?.type !== "Point") continue;
      const lng = geom.coordinates[0];
      const lat = geom.coordinates[1];
      if (typeof lng !== "number" || typeof lat !== "number") continue;
      const coords: [number, number] = [lng, lat];
      const key = props.cluster ? `c${props.cluster_id}` : `p${props.id}`;
      if (keep.has(key)) continue;
      keep.add(key);
      if (shown.has(key)) continue;
      const el = props.cluster
        ? clusterMarker(Number(props.total), async () => {
            const src = map.getSource("places") as GeoJSONSource;
            const zoom = await src.getClusterExpansionZoom(Number(props.cluster_id));
            map.easeTo({ center: coords, zoom });
          })
        : placeMarker({
            id: String(props.id),
            name: String(props.name),
            count: Number(props.count),
            thumb: String(props.thumb),
          });
      shown.set(key, new Marker({ element: el }).setLngLat(coords).addTo(map));
    }
    for (const [k, m] of shown) {
      if (!keep.has(k)) {
        m.remove();
        shown.delete(k);
      }
    }
  };
  map.on("moveend", update);
  map.on("sourcedata", (e) => e.sourceId === "places" && e.isSourceLoaded && update());
}

export function Globe() {
  const { data: places, error } = useApi(endpoints.places, Places);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current || !places) return;
    const n = places.length || 1;
    const center: [number, number] = [
      places.reduce((s, p) => s + p.lon, 0) / n,
      places.reduce((s, p) => s + p.lat, 0) / n,
    ];
    const map = createMap(el.current, center, places.length > 1 ? 1.4 : 4);
    map.on("load", () => mountPlaces(map, places));
    return () => map.remove();
  }, [places]);

  const sorted = places ? [...places].sort((a, b) => b.count - a.count) : [];
  return (
    <main className="globe">
      <h1 className="sr-only">{t.globe.title}</h1>
      <div ref={el} className="map" role="application" aria-label={t.globe.title} data-testid="globe" />
      {error && <p className="notice globe-empty">{error}</p>}
      {places && places.length === 0 && <p className="notice globe-empty">{t.globe.empty}</p>}
      {sorted.length > 0 && (
        <nav className="place-strip" aria-label={t.globe.places}>
          {sorted.map((p) => (
            <Link
              key={p.id}
              className="place-chip"
              href={`/lugar/${encodeURIComponent(p.id)}`}
              data-testid="place-chip"
            >
              {p.coverThumbUrl ? <img src={p.coverThumbUrl} alt="" loading="lazy" /> : <span className="dot" />}
              <span>
                {p.name} · {p.count}
              </span>
            </Link>
          ))}
        </nav>
      )}
    </main>
  );
}

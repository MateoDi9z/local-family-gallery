// MapLibre con el estilo de OpenFreeMap (la única excepción de internet permitida) en modo globo.
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MlMap, NavigationControl } from "maplibre-gl";

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function createMap(container: HTMLElement, center: [number, number], zoom: number) {
  const map = new MlMap({ container, style: MAP_STYLE, center, zoom, attributionControl: { compact: true } });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.on("style.load", () => map.setProjection({ type: "globe" }));
  return map;
}

// MapLibre con el estilo de OpenFreeMap (la única excepción de internet permitida) en modo globo.
import "maplibre-gl/dist/maplibre-gl.css";
import { type ExpressionSpecification, Map as MlMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// MapLibre arma la URL del worker en runtime y Vite no la empaqueta: sin esto el globo queda en blanco.
setWorkerUrl(workerUrl);

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function createMap(container: HTMLElement, center: [number, number], zoom: number) {
  const map = new MlMap({ container, style: MAP_STYLE, center, zoom, attributionControl: { compact: true } });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.on("style.load", () => {
    map.setProjection({ type: "globe" });
    // El mapa nace plano y con zoom bajo recorta la latitud del centro: se vuelve a centrar ya en globo.
    map.jumpTo({ center, zoom });
    map.setSky({ "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] });
    // Nombres en español cuando el mapa los tiene; si no, el que trae el estilo.
    for (const layer of map.getStyle().layers) {
      if (layer.type !== "symbol") continue;
      const field = map.getLayoutProperty(layer.id, "text-field");
      if (JSON.stringify(field ?? "").includes('"name'))
        map.setLayoutProperty(layer.id, "text-field", [
          "coalesce",
          ["get", "name:es"],
          field as ExpressionSpecification,
        ]);
    }
  });
  return map;
}

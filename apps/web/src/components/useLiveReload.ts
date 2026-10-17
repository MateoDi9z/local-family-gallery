import { API_PREFIX, endpoints } from "@lfg/shared";
import { useEffect } from "react";

/** Mientras `active`, recarga con cada evento SSE de /events y, por las dudas, cada 3 s. */
export function useLiveReload(active: boolean, reload: () => void) {
  useEffect(() => {
    if (!active) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(pending);
      pending = setTimeout(reload, 400);
    };
    const es = "EventSource" in window ? new EventSource(API_PREFIX + endpoints.events) : null;
    if (es) es.onmessage = soon;
    const poll = setInterval(reload, 3000);
    return () => {
      es?.close();
      clearInterval(poll);
      clearTimeout(pending);
    };
  }, [active, reload]);
}

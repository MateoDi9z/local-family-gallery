// Agrupar todas las fotos por fecha (salidas) o por lugar. Las fotos llegan de la más nueva a la más vieja.
import { type MediaItem, TRIP_GAP_MS } from "@lfg/shared";

export type PhotoGroup = {
  key: string;
  items: MediaItem[];
  /** El lugar con más fotos del grupo (en "por lugar", el del grupo). */
  placeId: string | null;
  /** Primera y última fecha; null si ninguna foto tiene fecha. */
  startAt: string | null;
  endAt: string | null;
};

function group(key: string, items: MediaItem[]): PhotoGroup {
  const counts = new Map<string, number>();
  for (const m of items) if (m.placeId) counts.set(m.placeId, (counts.get(m.placeId) ?? 0) + 1);
  const dates = items.map((m) => m.takenAt).filter((d): d is string => d !== null);
  return {
    key,
    items,
    placeId: [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    startAt: dates.at(-1) ?? null,
    endAt: dates[0] ?? null,
  };
}

/** Fechas cercanas juntas: corta cuando pasan más de 36 h entre una foto y la siguiente (como los viajes). */
export function groupByDate(items: MediaItem[]): PhotoGroup[] {
  const out: PhotoGroup[] = [];
  const noDate: MediaItem[] = [];
  let cur: MediaItem[] = [];
  let last = 0;
  for (const m of items) {
    if (!m.takenAt) {
      noDate.push(m);
      continue;
    }
    const t = Date.parse(m.takenAt);
    if (cur.length && last - t > TRIP_GAP_MS) {
      out.push(group(`d-${cur[0]?.id}`, cur));
      cur = [];
    }
    cur.push(m);
    last = t;
  }
  if (cur.length) out.push(group(`d-${cur[0]?.id}`, cur));
  if (noDate.length) out.push(group("d-sin-fecha", noDate));
  return out;
}

/** Una ciudad por grupo, la de la foto más reciente primero; las que no tienen lugar, al final. */
export function groupByPlace(items: MediaItem[]): PhotoGroup[] {
  const by = new Map<string | null, MediaItem[]>();
  for (const m of items) by.set(m.placeId, [...(by.get(m.placeId) ?? []), m]);
  const groups = [...by].map(([placeId, ms]) => ({ ...group(`p-${placeId ?? "sin-lugar"}`, ms), placeId }));
  return [...groups.filter((g) => g.placeId), ...groups.filter((g) => !g.placeId)];
}

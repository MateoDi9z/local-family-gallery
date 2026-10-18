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

export type DayGroup = {
  key: string;
  /** Día del viaje: 1 el primero; cuenta días de calendario, así que un día sin fotos se saltea. */
  day: number;
  /** Fecha local de la toma, «2026-05-14»; vacía para las que no tienen fecha. */
  date: string;
  /** Los lugares del día en el orden en que se visitaron, cada uno una vez y con sus fotos en orden. */
  places: { placeId: string | null; items: MediaItem[] }[];
  /** Todas las del día, lugar por lugar. */
  items: MediaItem[];
};

const offsetMs = (tz: string | null) => {
  const m = tz && /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : null;
};

/**
 * Dentro de un viaje: un grupo por día y, adentro, las fotos juntas por lugar (en el orden en que se visitó).
 * El día es el local de la toma; las fotos sin zona horaria usan la más común del viaje (o la del celu).
 * `items` en orden cronológico, como las da el viaje.
 */
export function groupByDay(items: MediaItem[]): DayGroup[] {
  const tzs = new Map<string, number>();
  for (const m of items)
    if (offsetMs(m.takenTz) !== null) tzs.set(m.takenTz as string, (tzs.get(m.takenTz as string) ?? 0) + 1);
  const common = offsetMs([...tzs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  const localDate = (takenAt: string, tz: string | null) => {
    const t = Date.parse(takenAt);
    const off = offsetMs(tz) ?? common ?? -new Date(t).getTimezoneOffset() * 60_000;
    return new Date(t + off).toISOString().slice(0, 10);
  };
  // Map conserva el orden de llegada: días en orden y, en cada día, lugares por primera visita.
  const days = new Map<string, Map<string | null, MediaItem[]>>();
  for (const m of items) {
    const date = m.takenAt ? localDate(m.takenAt, m.takenTz) : "";
    const day = days.get(date) ?? new Map<string | null, MediaItem[]>();
    day.set(m.placeId, [...(day.get(m.placeId) ?? []), m]);
    days.set(date, day);
  }
  const dated = [...days.keys()].filter(Boolean);
  const first = dated.length ? Date.parse(dated[0] as string) : 0;
  const out = [...days].map(([date, byPlace]): DayGroup => {
    const places = [...byPlace].map(([placeId, ms]) => ({ placeId, items: ms }));
    return {
      key: `day-${date || "sin-fecha"}`,
      day: date ? Math.round((Date.parse(date) - first) / 86_400_000) + 1 : 0,
      date,
      places,
      items: places.flatMap((p) => p.items),
    };
  });
  // Las sin fecha, al final.
  return [...out.filter((d) => d.date), ...out.filter((d) => !d.date)];
}

import { es } from "./es";

export const t = es;
export type { Texts } from "./es";

const dateFmt = new Intl.DateTimeFormat(es.dates.locale, { day: "numeric", month: "long", year: "numeric" });
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
const shortFmt = new Intl.DateTimeFormat(es.dates.locale, { day: "numeric", month: "numeric", year: "2-digit" });
/** «14/5/26»: para listas y títulos donde no entra la fecha larga. */
export const formatShortDate = (iso: string) => shortFmt.format(new Date(iso));
const dayFmt = new Intl.DateTimeFormat(es.dates.locale, {
  day: "numeric",
  month: "numeric",
  year: "2-digit",
  timeZone: "UTC",
});
const rtf = new Intl.RelativeTimeFormat(es.dates.locale, { numeric: "auto" });
/** «hace 5 minutos», «ayer»; a partir de una semana, la fecha. */
export function formatAgo(iso: string, now = Date.now()) {
  const s = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return es.activity.justNow;
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(s / 86_400), "day");
  return formatDate(iso);
}

/** Una fecha local ya calculada («2026-05-14») → «14/5/26», sin correrla por la zona del celu. */
export const formatDay = (ymd: string) => dayFmt.format(new Date(`${ymd}T00:00:00Z`));

export function formatBytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

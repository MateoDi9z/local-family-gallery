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

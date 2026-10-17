// exiftool persistente (`-stay_open`): un proceso perl por worker, ~2 ms por archivo en vez de ~50 ms.
// Tags y prioridades: DECISIONES.md, "E0 · Metadata: exiftool persistente".
import type { Subprocess } from "bun";

export const EXIF_TAGS = [
  "GPSLatitude",
  "GPSLongitude",
  "GPSCoordinates",
  "SubSecDateTimeOriginal",
  "DateTimeOriginal",
  "OffsetTimeOriginal",
  "CreateDate",
  "GPSDateTime",
  "CreationDate",
  "MediaCreateDate",
  "Make",
  "Model",
  "Orientation",
  "ImageWidth",
  "ImageHeight",
  "ContentIdentifier",
];

const READY = "{ready}\n";

export class ExifTool {
  private proc: Subprocess<"pipe", "pipe", "ignore"> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buf = "";
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private timeoutMs = 30_000) {}

  /** Metadata cruda (JSON de `exiftool -n -j`) de un archivo. Las llamadas se encolan de a una. */
  read(path: string): Promise<Record<string, unknown>> {
    const next = this.chain.then(() => this.ask(path));
    this.chain = next.catch(() => {});
    return next;
  }

  private start() {
    if (this.proc && this.proc.exitCode === null && !this.proc.killed) return;
    this.proc = Bun.spawn(["exiftool", "-stay_open", "True", "-@", "-"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    this.reader = this.proc.stdout.getReader();
    this.buf = "";
  }

  private async ask(path: string): Promise<Record<string, unknown>> {
    this.start();
    const proc = this.proc as NonNullable<typeof this.proc>;
    const reader = this.reader as NonNullable<typeof this.reader>;
    // Un argumento por línea: nuestras rutas nunca llevan saltos de línea, pero por las dudas se rechazan.
    if (path.includes("\n")) throw new Error("ruta inválida para exiftool");
    proc.stdin.write(`-n\n-j\n-fast\n${EXIF_TAGS.map((t) => `-${t}`).join("\n")}\n${path}\n-execute\n`);
    proc.stdin.flush();
    const dec = new TextDecoder();
    let timer: Timer | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`exiftool no respondió en ${this.timeoutMs} ms`)), this.timeoutMs);
    });
    try {
      while (!this.buf.includes(READY)) {
        const { value, done } = await Promise.race([reader.read(), timeout]);
        if (done) throw new Error("exiftool terminó inesperadamente");
        this.buf += dec.decode(value, { stream: true });
      }
    } catch (e) {
      this.kill(); // el próximo pedido arranca un proceso nuevo
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const i = this.buf.indexOf(READY);
    const out = this.buf.slice(0, i).trim();
    this.buf = this.buf.slice(i + READY.length);
    if (!out) throw new Error("exiftool no pudo leer el archivo");
    const arr = JSON.parse(out) as Record<string, unknown>[];
    return arr[0] ?? {};
  }

  private kill() {
    this.proc?.kill();
    this.proc = null;
    this.reader = null;
    this.buf = "";
  }

  async close() {
    const p = this.proc;
    if (!p) return;
    try {
      p.stdin.write("-stay_open\nFalse\n");
      p.stdin.end();
    } catch {}
    await Promise.race([p.exited, Bun.sleep(2000)]);
    this.kill();
  }
}

// ── Parseo ─────────────────────────────────────────────────────────

export type TakenAt = { utc: string; tz: string | null; local: Date };

export type ParsedMeta = {
  taken: TakenAt | null;
  lat: number | null;
  lon: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  orientation: number | null;
  width: number | null;
  height: number | null;
  liveId: string | null;
};

const DATE_RE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Fecha de exiftool (`AAAA:MM:DD HH:MM:SS[.sss][±HH:MM|Z]`). `tz` explícito gana sobre el del texto.
 * Sin zona: se toma la hora tal cual como UTC y `tz` queda null (no sabemos la zona).
 * `local` es la hora local de la toma guardada en los campos UTC de un Date (para nombrar el archivo).
 */
export function parseExifDate(value: unknown, tz?: unknown): TakenAt | null {
  if (typeof value !== "string") return null;
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  if (Number(y) < 1900 || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  const ms = frac ? Math.round(Number(frac) * 1000) : 0;
  const local = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms));
  if (Number.isNaN(local.getTime())) return null;
  const off = normalizeTz(typeof tz === "string" ? tz : zone);
  const utc = new Date(local.getTime() - (off ? offsetMinutes(off) * 60_000 : 0));
  return { utc: utc.toISOString(), tz: off, local };
}

function normalizeTz(z: string | undefined): string | null {
  if (!z) return null;
  if (z === "Z") return "+00:00";
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(z.trim());
  return m ? `${m[1]}${m[2]}:${m[3]}` : null;
}
const offsetMinutes = (tz: string) => (tz[0] === "-" ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(4, 6)));

/** Hora local de la toma a partir de lo guardado en la base (UTC + offset). */
export function localFromUtc(utcIso: string, tz: string | null): Date {
  return new Date(new Date(utcIso).getTime() + (tz ? offsetMinutes(tz) * 60_000 : 0));
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

function parseGps(j: Record<string, unknown>): { lat: number; lon: number } | null {
  let lat = num(j.GPSLatitude);
  let lon = num(j.GPSLongitude);
  if (lat === null || lon === null) {
    // Respaldo de videos: `GPSCoordinates` = "lat lon [alt]" (Keys o UserData de QuickTime).
    const m = typeof j.GPSCoordinates === "string" ? /^\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(j.GPSCoordinates) : null;
    lat = m ? Number(m[1]) : null;
    lon = m ? Number(m[2]) : null;
  }
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return null; // 0,0: GPS sin señal
  return { lat, lon };
}

/** Fecha que viene en UTC (el instante es exacto, pero la zona local de la toma no se conoce). */
function utcDate(value: unknown): TakenAt | null {
  const t = parseExifDate(value, "Z");
  return t && { utc: t.utc, tz: null, local: t.local };
}

/** Metadata útil según el tipo, con la prioridad de tags de DECISIONES (fotos vs videos). */
export function parseMeta(j: Record<string, unknown>, kind: "photo" | "video"): ParsedMeta {
  const taken =
    kind === "photo"
      ? (parseExifDate(j.SubSecDateTimeOriginal, j.OffsetTimeOriginal) ??
        parseExifDate(j.DateTimeOriginal, j.OffsetTimeOriginal) ??
        parseExifDate(j.CreateDate) ??
        utcDate(j.GPSDateTime))
      : // Keys:CreationDate es local con zona; CreateDate/MediaCreateDate de QuickTime son UTC sin zona.
        (parseExifDate(j.CreationDate) ?? utcDate(j.CreateDate) ?? utcDate(j.MediaCreateDate));
  const gps = parseGps(j);
  const orientation = kind === "photo" ? (num(j.Orientation) ?? 1) : null;
  let width = num(j.ImageWidth);
  let height = num(j.ImageHeight);
  // Dimensiones de pantalla: con Orientation 5–8 la imagen se ve girada 90°.
  if (orientation && orientation >= 5 && orientation <= 8) [width, height] = [height, width];
  return {
    taken,
    lat: gps?.lat ?? null,
    lon: gps?.lon ?? null,
    cameraMake: str(j.Make),
    cameraModel: str(j.Model),
    orientation,
    width,
    height,
    liveId: str(j.ContentIdentifier),
  };
}

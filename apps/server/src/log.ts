// Logs estructurados (JSON por línea). En nivel info: nada de datos personales ni rutas completas de fotos.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;
export type Logger = Record<Level, (msg: string, fields?: Record<string, unknown>) => void>;

export function createLogger(min: Level = "info", base: Record<string, unknown> = {}): Logger {
  const write = (level: Level) => (msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] < LEVELS[min]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...base, ...fields });
    (level === "error" || level === "warn" ? console.error : console.log)(line);
  };
  return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

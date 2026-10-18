// Estado del sistema: desde este dispositivo se revisa la red, internet, HTTPS y el servidor; del servidor,
// la base, el worker, la cola y los discos. Se actualiza sola mientras está abierta.
import { AdminStatus, API_PREFIX, endpoints, HealthResponse } from "@lfg/shared";
import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api/client";
import { MAP_STYLE } from "../components/map";
import { formatBytes, formatDate, t } from "../i18n";
import { Link } from "../router";
import { useSaver } from "./Admin";

const REFRESH_MS = 15_000;
const TIMEOUT_MS = 8_000;

type Level = "ok" | "warn" | "bad" | "unknown";
type Probe<T> = { value: T; ms: number } | { error: string } | null;

/** Corre `fn` cada vez que cambia `tick`. Mientras revisa, sigue mostrando el resultado anterior. */
function useProbe<T>(fn: (() => Promise<T>) | null, tick: number): Probe<T> {
  const [r, setR] = useState<Probe<T>>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick fuerza la revisión; fn es fija por pantalla.
  useEffect(() => {
    if (!fn) return;
    let alive = true;
    const t0 = performance.now();
    fn().then(
      (value) => alive && setR({ value, ms: Math.round(performance.now() - t0) }),
      (e) => alive && setR({ error: errorText(e) }),
    );
    return () => {
      alive = false;
    };
  }, [tick]);
  return r;
}

/** fetch con tope de tiempo: sin wifi, un pedido puede quedar colgado mucho rato. */
async function reach(url: string) {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res;
}

function deviceCheck(): [Level, string] {
  // `connection.type` solo existe en Chrome de Android; en el resto no se sabe si es wifi o datos.
  const type = (navigator as Navigator & { connection?: { type?: string } }).connection?.type;
  if (!navigator.onLine) return ["bad", t.status.deviceOffline];
  if (type === "cellular") return ["warn", t.status.deviceCellular];
  return ["ok", type === "wifi" ? t.status.deviceWifi : t.status.deviceOnline];
}

/** `down`: el App no llega al servidor; la pantalla se muestra igual, sin lo que pide PIN. */
export function SystemStatus({ down }: { down?: () => void }) {
  const [tick, setTick] = useState(0);
  // Con el servidor caído también le pide al App que vuelva a probar, así entra solo cuando vuelve.
  const refresh = useCallback(() => {
    setTick((n) => n + 1);
    down?.();
  }, [down]);
  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, [refresh]);

  const internet = useProbe(() => reach(MAP_STYLE), tick);
  const health = useProbe(
    async () => HealthResponse.parse(await (await reach(API_PREFIX + endpoints.health)).json()),
    tick,
  );
  const status = useProbe(down ? null : () => api.get(endpoints.adminStatus, AdminStatus), tick);

  const st = status && "value" in status ? status.value : null;
  const pending = !status && !down ? t.status.checking : t.status.unknown;
  const secure = window.isSecureContext;
  const rows: [string, Level, string][] = [
    [t.status.device, ...deviceCheck()],
    [
      t.status.internet,
      !internet ? "unknown" : "error" in internet ? "bad" : "ok",
      !internet ? t.status.checking : "error" in internet ? t.status.internetDown : t.status.internetOk(internet.ms),
    ],
    [t.status.secure, secure ? "ok" : "warn", secure ? t.status.secureOk : t.status.secureNo],
    [
      t.status.server,
      !health ? "unknown" : "error" in health ? "bad" : "ok",
      !health
        ? t.status.checking
        : "error" in health
          ? t.serverDown
          : t.status.serverOk(health.ms, health.value.version),
    ],
    [
      t.status.db,
      !status ? "unknown" : "error" in status ? "bad" : "ok",
      !status ? pending : "error" in status ? status.error : t.status.dbOk,
    ],
    [
      t.status.worker,
      !st ? "unknown" : st.worker.alive ? "ok" : "bad",
      !st
        ? pending
        : st.worker.alive
          ? t.status.workerOk
          : t.status.workerDown(
              st.worker.seenAt &&
                new Date(st.worker.seenAt).toLocaleString(t.dates.locale, { dateStyle: "short", timeStyle: "short" }),
            ),
    ],
  ];
  const levels = rows.map((r) => r[1]);
  const overall: Level = levels.includes("bad")
    ? "bad"
    : levels.includes("unknown") && !down
      ? "unknown"
      : levels.includes("warn")
        ? "warn"
        : "ok";

  return (
    <main className="screen stack">
      {down ? (
        <p className="error" role="alert">
          {t.serverDown}
        </p>
      ) : (
        <Link href="/mas" className="btn link">
          {t.back}
        </Link>
      )}
      <h1>{t.status.title}</h1>
      <p className={`notice check-summary ${overall}`}>{t.status.summary[overall]}</p>
      <section className="card stack">
        {rows.map(([name, level, detail]) => (
          <div key={name} className="check">
            <span className={`check-dot ${level}`} role="img" aria-label={t.status.levels[level]} />
            <strong>{name}</strong>
            <span className="muted">{detail}</span>
          </div>
        ))}
        <p className="muted">{t.status.auto}</p>
        <button type="button" className="btn" onClick={refresh}>
          {t.status.recheck}
        </button>
      </section>
      {st && <ServerDetails status={st} onRetry={refresh} />}
    </main>
  );
}

function ServerDetails({ status, onRetry }: { status: AdminStatus; onRetry: () => void }) {
  const [retried, setRetried] = useState(false);
  const { save, view } = useSaver();
  const q = status.queue;
  return (
    <>
      <section className="card stack">
        <h2>{t.admin.queue}</h2>
        <p>{t.admin.queueState(q.queued, q.running, q.failed)}</p>
        {status.gpu && <p className="muted">{t.admin.gpu(status.gpu.nvenc)}</p>}
        {q.failed > 0 && (
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              if (await save(() => api.post(endpoints.adminRetryFailed, {}))) {
                setRetried(true);
                onRetry();
              }
            }}
          >
            {t.admin.retryFailed}
          </button>
        )}
        {retried && <p role="status">{t.admin.retried}</p>}
        {view}
        <h2>{t.admin.errors}</h2>
        {status.errors.length === 0 ? (
          <p className="muted">{t.admin.noErrors}</p>
        ) : (
          <ul>
            {status.errors.map((e) => (
              <li key={e.jobId}>
                <strong>{e.type}</strong> · {formatDate(e.at)} — {e.error}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card stack">
        <h2>{t.admin.disks}</h2>
        {status.volumes.map((v) => (
          <div key={v.id} className="stack">
            <strong>
              {t.admin.disk(v.tier)} <span className="muted">{v.path}</span>
            </strong>
            <div className={`progress${v.alert ? " bar-alert" : ""}`}>
              <div style={{ width: `${Math.min(100, v.usedPercent)}%` }} />
            </div>
            <span>{t.admin.diskUse(Math.round(v.usedPercent), formatBytes(v.freeBytes))}</span>
            {v.alert && (
              <p className="error" role="alert">
                {t.admin.diskAlert}
              </p>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

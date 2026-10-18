// Guía de la tele: qué hace falta, cómo se usa y un chequeo en vivo de si este dispositivo puede mandar a la tele.
// Android y compu: Chromecast. iPhone y iPad: AirPlay (Apple TV o tele compatible).
import { useEffect, useState } from "react";
import { castState, connectCast, isIOS } from "../cast";
import { t } from "../i18n";
import { Link } from "../router";
import { useStore } from "../store";

type Level = "ok" | "warn" | "bad";

/** Si Safari avisa que hay una tele con AirPlay en el wifi. `null`: no lo dice (otro navegador, o todavía no). */
function useAirPlay(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!("WebKitPlaybackTargetAvailabilityEvent" in window)) return;
    const v = document.createElement("video");
    const on = (e: Event) => setAvailable((e as Event & { availability?: string }).availability === "available");
    v.addEventListener("webkitplaybacktargetavailabilitychanged", on);
    return () => v.removeEventListener("webkitplaybacktargetavailabilitychanged", on);
  }, []);
  return available;
}

function useCheck(ios: boolean): [Level, string] {
  const s = useStore(castState);
  const airplay = useAirPlay();
  const ua = navigator.userAgent;
  if (ios) return airplay === true ? ["ok", t.tv.checkAirplayFound] : ["ok", t.tv.checkIphone];
  if (s.connected) return ["ok", t.tv.checkConnected(s.device)];
  // Mismo criterio que initCast: sin Chrome no se carga el SDK de Cast.
  if (!/Chrome\//.test(ua)) return ["bad", t.tv.checkBrowser];
  if (!s.available) return ["warn", t.tv.checkLoading];
  if (!s.devices) return ["warn", t.tv.checkNoDevices];
  return ["ok", t.tv.checkReady];
}

export function Tv() {
  const s = useStore(castState);
  const ios = isIOS();
  const [level, text] = useCheck(ios);
  const guide = ios ? t.tv.iphone : t.tv.chrome;
  return (
    <main className="screen stack">
      <Link href="/mas" className="btn link">
        {t.back}
      </Link>
      <h1>{t.tv.title}</h1>
      <p>{t.tv.intro}</p>

      <section className="card stack">
        <h2>{t.tv.checkTitle}</h2>
        <div className="check">
          <span className={`check-dot ${level}`} role="img" aria-label={t.status.levels[level]} />
          <strong>{text}</strong>
        </div>
        {s.available && !s.connected && (
          <button type="button" className="btn primary" onClick={connectCast}>
            {t.tv.connect}
          </button>
        )}
      </section>

      {guide.sections.map((sec) => (
        <section key={sec.title} className="card stack">
          <h2>{sec.title}</h2>
          <ol className="steps">
            {sec.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ))}

      <section className="card stack">
        <h2>{t.tv.troubleTitle}</h2>
        {guide.trouble.map(([q, a]) => (
          <p key={q}>
            <strong>{q}</strong> {a}
          </p>
        ))}
      </section>
    </main>
  );
}

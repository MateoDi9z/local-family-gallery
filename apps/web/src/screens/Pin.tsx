import { endpoints } from "@lfg/shared";
import { useEffect, useState } from "react";
import { api, errorText } from "../api/client";
import { t } from "../i18n";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function Pin({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const press = (d: string) => setPin((p) => (p.length < 8 ? p + d : p));
  const erase = () => setPin((p) => p.slice(0, -1));
  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    try {
      await api.post(endpoints.authPin, { pin });
      onDone();
    } catch (e) {
      setError(errorText(e));
      setPin("");
      setBusy(false);
    }
  };

  // Teclado físico en la compu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: submit lee el pin actual en cada render.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") erase();
      else if (e.key === "Enter") submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin]);

  return (
    <main className="screen center">
      <h1 style={{ textAlign: "center" }}>{t.pin.title}</h1>
      <p className="muted" style={{ textAlign: "center" }}>
        {t.pin.help}
      </p>
      <div className="pin-dots" role="status" aria-label={t.pin.shown(pin.length)}>
        {Array.from(pin, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: puntos sin identidad propia.
          <span key={i} />
        ))}
      </div>
      {error && (
        <p className="error" role="alert" style={{ textAlign: "center" }}>
          {error}
        </p>
      )}
      <div className="keypad">
        {KEYS.map((d) => (
          <button type="button" key={d} aria-label={t.pin.digit(d)} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" onClick={erase}>
          {t.pin.erase}
        </button>
        <button type="button" aria-label={t.pin.digit("0")} onClick={() => press("0")}>
          0
        </button>
        <button type="button" className="enter" disabled={pin.length < 4 || busy} onClick={submit}>
          {t.pin.enter}
        </button>
      </div>
    </main>
  );
}

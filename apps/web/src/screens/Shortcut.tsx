// Guía del Atajo de iOS: crear la clave desde la app, mostrarla una vez y explicar los pasos.
import { API_PREFIX, endpoints, type Member, ShortcutTokenCreated } from "@lfg/shared";
import { useState } from "react";
import { api, errorText } from "../api/client";
import { t } from "../i18n";
import { Link } from "../router";

export function Shortcut({ members, me }: { members: Member[]; me: string | null }) {
  const active = members.filter((m) => !m.archived);
  const [memberId, setMemberId] = useState(me ?? active[0]?.id ?? "");
  const [label, setLabel] = useState<string>(t.shortcut.labelDefault);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `${location.origin}${API_PREFIX}${endpoints.shortcutUpload}`;

  const create = async () => {
    setError(null);
    try {
      const r = await api.post(endpoints.shortcutTokens, { memberId, label: label.trim() }, ShortcutTokenCreated);
      setToken(r.token);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const copy = async (text: string) => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
  };

  return (
    <main className="screen stack">
      <Link href="/mas" className="btn link">
        {t.back}
      </Link>
      <h1>{t.shortcut.title}</h1>
      <p>{t.shortcut.intro}</p>
      <section className="card stack">
        <fieldset className="chips" style={{ border: 0, margin: 0, flexWrap: "wrap" }}>
          <legend>{t.shortcut.who}</legend>
          {active.map((m) => (
            <button
              type="button"
              key={m.id}
              className="chip"
              aria-pressed={memberId === m.id}
              onClick={() => {
                setMemberId(m.id);
                setToken(null);
              }}
            >
              <span className="swatch" style={{ background: m.color }} />
              {m.name}
            </button>
          ))}
        </fieldset>
        <label htmlFor="sc-label">{t.shortcut.label}</label>
        <input id="sc-label" type="text" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        <button type="button" className="btn primary" disabled={!memberId || !label.trim()} onClick={create}>
          {t.shortcut.create}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {token && (
          <div className="stack" role="status">
            <strong>{t.shortcut.tokenTitle}</strong>
            <code className="token" data-testid="shortcut-token">
              {token}
            </code>
            <button type="button" className="btn" onClick={() => copy(token)}>
              {copied ? t.shortcut.copied : t.shortcut.copy}
            </button>
          </div>
        )}
      </section>
      <section className="card stack">
        <h2>{t.shortcut.urlTitle}</h2>
        <code className="token">{url}</code>
        <button type="button" className="btn" onClick={() => copy(url)}>
          {t.shortcut.copy}
        </button>
      </section>
      <section className="card">
        <h2>{t.shortcut.stepsTitle}</h2>
        <ol className="steps">
          {t.shortcut.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="notice stack">
          <strong>{t.shortcut.updateTitle}</strong>
          <span>{t.shortcut.update}</span>
        </div>
      </section>
      <section className="card">
        <h2>{t.shortcut.keepTitle}</h2>
        <ul className="steps">
          {t.shortcut.keep.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

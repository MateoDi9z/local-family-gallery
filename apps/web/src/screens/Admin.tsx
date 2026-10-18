import { endpoints, type Member, Settings } from "@lfg/shared";
import { useState } from "react";
import { api, errorText } from "../api/client";
import { useApi } from "../api/hooks";
import { MapPicker } from "../components/MapPicker";
import { t } from "../i18n";
import { Link } from "../router";
import { Failure, Loading } from "./Galleries";
import { MEMBER_COLORS } from "./Setup";

/** Guarda con un mensaje de "Guardado" o el error, en lenguaje humano. */
export function useSaver() {
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    setError(null);
    try {
      await fn();
      setMsg(t.saved);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  const view = (
    <>
      {msg && <p role="status">{msg}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  return { save, view };
}

export function Admin({ members, onMembersChanged }: { members: Member[]; onMembersChanged: () => void }) {
  const settings = useApi(endpoints.settings, Settings);
  if (settings.error) return <Failure text={settings.error} />;
  if (!settings.data) return <Loading />;
  return (
    <main className="screen stack">
      <Link href="/mas" className="btn link">
        {t.back}
      </Link>
      <h1>{t.admin.title}</h1>
      <GallerySettings settings={settings.data} />
      <Members members={members} onChanged={onMembersChanged} />
      <HomeLocation settings={settings.data} />
      <PinChange />
    </main>
  );
}

function GallerySettings({ settings }: { settings: { galleryName: string } }) {
  const [name, setName] = useState(settings.galleryName);
  const { save, view } = useSaver();
  return (
    <section className="card stack">
      <label htmlFor="admin-name">{t.admin.galleryName}</label>
      <input id="admin-name" type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <button
        type="button"
        className="btn primary"
        disabled={!name.trim()}
        onClick={() => save(() => api.patch(endpoints.settings, { galleryName: name.trim() }))}
      >
        {t.save}
      </button>
      {view}
    </section>
  );
}

function Members({ members, onChanged }: { members: Member[]; onChanged: () => void }) {
  const [newName, setNewName] = useState("");
  const { save, view } = useSaver();
  const patch = (id: string, body: Partial<Member>) =>
    save(() => api.patch(endpoints.member(id), body)).then(onChanged);
  return (
    <section className="card stack">
      <h2>{t.admin.members}</h2>
      {members.map((m) => (
        <div key={m.id} className="member-row">
          <input
            type="text"
            aria-label={t.admin.nameOf(m.name)}
            defaultValue={m.name}
            maxLength={40}
            onBlur={(e) =>
              e.target.value.trim() && e.target.value !== m.name && patch(m.id, { name: e.target.value.trim() })
            }
          />
          <input
            type="color"
            className="color-input"
            aria-label={t.admin.colorOf(m.name)}
            defaultValue={m.color}
            onBlur={(e) => e.target.value !== m.color && patch(m.id, { color: e.target.value })}
          />
          <button type="button" className="btn link" onClick={() => patch(m.id, { archived: !m.archived })}>
            {m.archived ? t.admin.unarchive : t.admin.archive}
          </button>
        </div>
      ))}
      <div className="row">
        <input
          type="text"
          aria-label={t.admin.newMember}
          placeholder={t.setup.memberPlaceholder(members.length + 1)}
          value={newName}
          maxLength={40}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!newName.trim()}
          onClick={async () => {
            const color = MEMBER_COLORS[members.length % MEMBER_COLORS.length];
            if (await save(() => api.post(endpoints.members, { name: newName.trim(), color }))) {
              setNewName("");
              onChanged();
            }
          }}
        >
          {t.admin.addMember}
        </button>
      </div>
      {view}
    </section>
  );
}

function HomeLocation({ settings }: { settings: { home: { lat: number; lon: number } } }) {
  const { save, view } = useSaver();
  return (
    <section className="card stack">
      <h2>{t.admin.home}</h2>
      <p className="muted">{t.admin.homeHelp}</p>
      <MapPicker
        value={settings.home}
        label={t.admin.home}
        onChange={(home) => save(() => api.patch(endpoints.settings, { home }))}
      />
      {view}
    </section>
  );
}

function PinChange() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { save, view } = useSaver();
  const submit = async () => {
    if (!/^\d{4,8}$/.test(a)) return setErr(t.setup.pinShort);
    if (a !== b) return setErr(t.setup.pinMismatch);
    setErr(null);
    if (await save(() => api.patch(endpoints.settings, { pin: a }))) {
      setA("");
      setB("");
    }
  };
  return (
    <section className="card stack">
      <h2>{t.admin.pin}</h2>
      <label htmlFor="pin-new">{t.admin.pinNew}</label>
      <input
        id="pin-new"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        value={a}
        maxLength={8}
        onChange={(e) => setA(e.target.value.replace(/\D/g, ""))}
      />
      <label htmlFor="pin-again">{t.admin.pinAgain}</label>
      <input
        id="pin-again"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        value={b}
        maxLength={8}
        onChange={(e) => setB(e.target.value.replace(/\D/g, ""))}
      />
      <button type="button" className="btn primary" onClick={submit}>
        {t.save}
      </button>
      {err && <p className="error">{err}</p>}
      {view}
    </section>
  );
}

import { endpoints, SetupRequest } from "@lfg/shared";
import { useState } from "react";
import { api, errorText } from "../api/client";
import { type LatLon, MapPicker } from "../components/MapPicker";
import { t } from "../i18n";

export const MEMBER_COLORS = ["#d9480f", "#2b8a3e", "#1971c2", "#ae3ec9", "#e8590c", "#0c8599", "#c2255c", "#5f3dc4"];
const nextColor = (i: number) => MEMBER_COLORS[i % MEMBER_COLORS.length] as string;
const TOTAL = 4;

export function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [galleryName, setGalleryName] = useState<string>(t.setup.nameDefault);
  const [members, setMembers] = useState([{ name: "", color: nextColor(0) }]);
  const [home, setHome] = useState<LatLon | null>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validMembers = members.filter((m) => m.name.trim());
  const canNext =
    (step === 1 && galleryName.trim().length > 0) || (step === 2 && validMembers.length > 0) || (step === 3 && !!home);

  const finish = async () => {
    if (!/^\d{4,8}$/.test(pin)) return setError(t.setup.pinShort);
    if (pin !== pin2) return setError(t.setup.pinMismatch);
    const body = SetupRequest.safeParse({ galleryName, members: validMembers, home, pin });
    if (!body.success) return setError(t.errors.invalid);
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.setup, body.data);
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const setMember = (i: number, patch: Partial<{ name: string; color: string }>) =>
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <main className="screen stack">
      <p className="muted">{t.setup.step(step, TOTAL)}</p>
      {step === 1 && (
        <>
          <h1>{t.setup.title}</h1>
          <p>{t.setup.intro}</p>
          <h2>{t.setup.nameTitle}</h2>
          <label htmlFor="gallery-name">{t.setup.nameTitle}</label>
          <input id="gallery-name" type="text" value={galleryName} onChange={(e) => setGalleryName(e.target.value)} />
          <p className="muted">{t.setup.nameHelp}</p>
        </>
      )}
      {step === 2 && (
        <>
          <h1>{t.setup.membersTitle}</h1>
          <p className="muted">{t.setup.membersHelp}</p>
          {members.map((m, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: la lista solo crece o se recorta, sin reordenar.
            <div className="member-row" key={i}>
              <input
                type="text"
                aria-label={t.setup.memberName(i + 1)}
                placeholder={t.setup.memberPlaceholder(i + 1)}
                value={m.name}
                maxLength={40}
                onChange={(e) => setMember(i, { name: e.target.value })}
              />
              <input
                type="color"
                className="color-input"
                aria-label={t.setup.memberColor(i + 1)}
                value={m.color}
                onChange={(e) => setMember(i, { color: e.target.value })}
              />
              {members.length > 1 ? (
                <button
                  type="button"
                  className="btn link"
                  onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}
                >
                  {t.setup.removeMember}
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() => setMembers((ms) => [...ms, { name: "", color: nextColor(ms.length) }])}
          >
            {t.setup.addMember}
          </button>
        </>
      )}
      {step === 3 && (
        <>
          <h1>{t.setup.homeTitle}</h1>
          <p className="muted">{t.setup.homeHelp}</p>
          <MapPicker value={home} onChange={setHome} label={t.setup.homeTitle} />
          <p role="status">{home ? t.setup.homeMarked : t.setup.homeMissing}</p>
        </>
      )}
      {step === 4 && (
        <>
          <h1>{t.setup.pinTitle}</h1>
          <p className="muted">{t.setup.pinHelp}</p>
          <label htmlFor="pin1">{t.setup.pin}</label>
          <input
            id="pin1"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
          <label htmlFor="pin2">{t.setup.pinAgain}</label>
          <input
            id="pin2"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={8}
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
          />
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        {step > 1 && (
          <button type="button" className="btn" onClick={() => setStep(step - 1)}>
            {t.back}
          </button>
        )}
        {step < TOTAL ? (
          <button type="button" className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
            {t.next}
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={busy} onClick={finish}>
            {busy ? t.setup.saving : t.setup.finish}
          </button>
        )}
      </div>
    </main>
  );
}

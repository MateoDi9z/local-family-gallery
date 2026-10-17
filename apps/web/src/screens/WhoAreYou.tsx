import { endpoints, type Member } from "@lfg/shared";
import { useState } from "react";
import { api, errorText } from "../api/client";
import { t } from "../i18n";

export function WhoAreYou({ members, onDone }: { members: Member[]; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const pick = async (memberId: string) => {
    try {
      await api.post(endpoints.meMember, { memberId });
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <main className="screen center">
      <h1>{t.who.title}</h1>
      <p className="muted">{t.who.help}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="who">
        {members
          .filter((m) => !m.archived)
          .map((m) => (
            <button type="button" key={m.id} style={{ background: m.color }} onClick={() => pick(m.id)}>
              {m.name}
            </button>
          ))}
      </div>
    </main>
  );
}

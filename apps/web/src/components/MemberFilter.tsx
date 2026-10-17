import type { MediaItem } from "@lfg/shared";
import { useMembers } from "../api/hooks";
import { t } from "../i18n";
import { memberFilter, useStore } from "../store";

export function useMemberFiltered<T extends { items: MediaItem[] }>(groups: T[]): T[] {
  const id = useStore(memberFilter);
  return id ? groups.map((g) => ({ ...g, items: g.items.filter((m) => m.memberId === id) })) : groups;
}

export function MemberFilter() {
  const members = useMembers().filter((m) => !m.archived);
  const id = useStore(memberFilter);
  if (members.length < 2) return null;
  return (
    <fieldset className="chips" style={{ border: 0, margin: 0 }}>
      <legend className="sr-only">{t.gallery.filterLabel}</legend>
      <button type="button" className="chip" aria-pressed={id === null} onClick={() => memberFilter.set(null)}>
        {t.all}
      </button>
      {members.map((m) => (
        <button
          type="button"
          key={m.id}
          className="chip"
          aria-pressed={id === m.id}
          onClick={() => memberFilter.set(m.id)}
        >
          <span className="swatch" style={{ background: m.color }} />
          {m.name}
        </button>
      ))}
    </fieldset>
  );
}

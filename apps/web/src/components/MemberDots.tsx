// Quiénes fueron, en chiquito: un círculo con la inicial y el color de cada persona.
import { useMembers } from "../api/hooks";
import { t } from "../i18n";

const MAX = 6;

/** «María José» → «MJ», «Persona 1» → «P1», «Juan» → «J». */
const initials = (name: string) => {
  const w = name.trim().split(/\s+/);
  return ((w[0]?.[0] ?? "") + (w.length > 1 ? (w.at(-1)?.[0] ?? "") : "")).toUpperCase();
};

export function MemberDots({ ids }: { ids: string[] }) {
  const all = useMembers();
  // En el orden de la galería, no en el que vinieron.
  const people = all.filter((m) => ids.includes(m.id));
  if (people.length === 0) return null;
  const names = people.map((m) => m.name).join(", ");
  return (
    <span className="member-dots" role="img" aria-label={t.trips.went(names)} title={names}>
      {people.slice(0, MAX).map((m) => (
        <span key={m.id} className="member-dot" style={{ background: m.color }}>
          {initials(m.name)}
        </span>
      ))}
      {people.length > MAX && <span className="member-dot more">+{people.length - MAX}</span>}
    </span>
  );
}

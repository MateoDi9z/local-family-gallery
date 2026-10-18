import { t } from "../i18n";
import { Link } from "../router";
import { APP_VERSION } from "../version";

export function More({ onChangeMember }: { onChangeMember: () => void }) {
  const links: [string, string][] = [
    ["/sin-ubicacion", t.more.noLocation],
    ["/parecidas", t.more.similar],
    ["/iphone", t.more.shortcut],
    ["/subidas", t.activity.title],
    ["/tele", t.more.tv],
    ["/estado", t.more.status],
    ["/admin", t.more.admin],
  ];
  return (
    <main className="screen stack">
      <h1>{t.more.title}</h1>
      {links.map(([href, label]) => (
        <Link key={href} href={href} className="btn big">
          {label}
        </Link>
      ))}
      <button type="button" className="btn big" onClick={onChangeMember}>
        {t.who.change}
      </button>
      <p className="muted version">{t.more.version(APP_VERSION)}</p>
    </main>
  );
}

import { endpoints, HomeResponse } from "@lfg/shared";
import { useApi, useMembers } from "../api/hooks";
import { Tile } from "../components/Grid";
import { openViewer } from "../components/viewer";
import { formatDate, t } from "../i18n";
import { Link } from "../router";
import { Failure, Loading } from "./Galleries";

export function Home() {
  const { data, error } = useApi(endpoints.home, HomeResponse);
  const members = useMembers();
  if (error) return <Failure text={error} />;
  if (!data) return <Loading />;
  const empty = data.onThisDay.length === 0 && !data.lastTrip;
  return (
    <main className="screen stack">
      <h1>{data.galleryName}</h1>
      {empty && <p className="notice">{t.home.empty}</p>}
      {data.onThisDay.map((d) => (
        <section key={d.yearsAgo} className="card stack">
          <h2>{t.home.yearsAgo(d.yearsAgo)}</h2>
          <div className="grid-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {d.media.slice(0, 6).map((m, i) => (
              <Tile key={m.id} m={m} onClick={() => openViewer(d.media, i)} />
            ))}
          </div>
        </section>
      ))}
      {data.lastTrip && (
        <section className="card stack">
          <h2>{t.home.lastTrip}</h2>
          <Link href={`/viaje/${encodeURIComponent(data.lastTrip.trip.id)}`} className="trip-card">
            {data.lastTrip.trip.coverThumbUrl ? (
              <img src={data.lastTrip.trip.coverThumbUrl} alt="" />
            ) : (
              <span className="ph" />
            )}
            <span>
              <strong>{data.lastTrip.trip.name}</strong>
              <br />
              <span className="muted">{formatDate(data.lastTrip.trip.startAt)}</span>
            </span>
          </Link>
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {data.lastTrip.perMember.map((pm) => {
              const m = members.find((x) => x.id === pm.memberId);
              return (
                <li key={pm.memberId} className="row">
                  <span className="swatch" style={{ background: m?.color ?? "#999" }} />
                  {t.home.perMember(m?.name ?? "", pm.count)}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <Link href="/" className="btn primary big">
        {t.home.seeMap}
      </Link>
    </main>
  );
}

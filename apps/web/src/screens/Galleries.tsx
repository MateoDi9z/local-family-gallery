// Galería de un lugar (agrupada por viaje), detalle de un viaje y línea de tiempo de viajes.
import { endpoints, type MediaItem, PlaceDetail, Trip, TripDetail } from "@lfg/shared";
import { useMemo, useState } from "react";
import { z } from "zod";
import { api, errorText } from "../api/client";
import { useApi } from "../api/hooks";
import { castItems, castState } from "../cast";
import { Grid, type Group } from "../components/Grid";
import { MemberFilter, useMemberFiltered } from "../components/MemberFilter";
import { openViewer } from "../components/viewer";
import { formatDate, t } from "../i18n";
import { Link } from "../router";
import { useStore } from "../store";

const tripDates = (tr: z.infer<typeof Trip>) => t.trips.dates(formatDate(tr.startAt), formatDate(tr.endAt));

function GroupTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h2>{title}</h2>
      <span className="muted">{sub}</span>
    </>
  );
}

function CastButton({ items }: { items: MediaItem[] }) {
  const { available } = useStore(castState);
  if (!available || items.length === 0) return null;
  return (
    <button type="button" className="btn" onClick={() => castItems(items, 0, true)}>
      {t.trips.slideshow}
    </button>
  );
}

export function PlaceGallery({ id }: { id: string }) {
  const { data, error } = useApi(endpoints.place(id), PlaceDetail);
  const groups = useMemo<Group[]>(
    () =>
      (data?.groups ?? []).map((g) => ({
        key: g.trip?.id ?? "local",
        title: g.trip ? (
          <GroupTitle title={g.trip.name} sub={`${tripDates(g.trip)} · ${t.gallery.count(g.media.length)}`} />
        ) : (
          <GroupTitle title={t.gallery.noTrip} sub={t.gallery.count(g.media.length)} />
        ),
        items: g.media,
      })),
    [data],
  );
  const filtered = useMemberFiltered(groups);
  if (error) return <Failure text={error} />;
  if (!data) return <Loading />;
  return (
    <main className="screen">
      <Link href="/" className="btn link">
        {t.back}
      </Link>
      <h1>{data.place.name}</h1>
      <p className="muted">{t.gallery.count(data.place.count)}</p>
      <MemberFilter />
      <CastButton items={filtered.flatMap((g) => g.items)} />
      <Grid groups={filtered} onOpen={(items, i) => openViewer(items, i)} />
    </main>
  );
}

export function TripGallery({ id }: { id: string }) {
  const { data, error, reload } = useApi(endpoints.trip(id), TripDetail);
  const groups = useMemo<Group[]>(() => (data ? [{ key: data.trip.id, items: data.media }] : []), [data]);
  const filtered = useMemberFiltered(groups);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  if (error) return <Failure text={error} />;
  if (!data) return <Loading />;
  const save = async () => {
    try {
      await api.patch(endpoints.trip(id), { name: name.trim() });
      setEditing(false);
      reload();
    } catch (e) {
      setSaveError(errorText(e));
    }
  };
  return (
    <main className="screen">
      <Link href="/viajes" className="btn link">
        {t.back}
      </Link>
      {editing ? (
        <div className="stack">
          <label htmlFor="trip-name">{t.trips.renameLabel}</label>
          <input id="trip-name" type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <div className="row">
            <button type="button" className="btn primary" disabled={!name.trim()} onClick={save}>
              {t.save}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              {t.cancel}
            </button>
          </div>
          {saveError && <p className="error">{saveError}</p>}
        </div>
      ) : (
        <>
          <h1>{data.trip.name}</h1>
          <p className="muted">
            {tripDates(data.trip)} · {t.gallery.count(data.trip.count)}
          </p>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setName(data.trip.name);
                setEditing(true);
              }}
            >
              {t.trips.rename}
            </button>
            <CastButton items={filtered.flatMap((g) => g.items)} />
          </div>
        </>
      )}
      <MemberFilter />
      <Grid groups={filtered} onOpen={(items, i) => openViewer(items, i)} />
    </main>
  );
}

const Trips = z.array(Trip);

export function Timeline() {
  const { data, error } = useApi(endpoints.trips, Trips);
  if (error) return <Failure text={error} />;
  if (!data) return <Loading />;
  const sorted = [...data].sort((a, b) => b.startAt.localeCompare(a.startAt));
  return (
    <main className="screen stack">
      <h1>{t.trips.title}</h1>
      {sorted.length === 0 && <p className="notice">{t.trips.empty}</p>}
      {sorted.map((tr) => (
        <Link key={tr.id} href={`/viaje/${encodeURIComponent(tr.id)}`} className="card trip-card">
          {tr.coverThumbUrl ? <img src={tr.coverThumbUrl} alt="" loading="lazy" /> : <span className="ph" />}
          <span>
            <h2>{tr.name}</h2>
            <span className="muted">
              {tripDates(tr)} · {t.gallery.count(tr.count)}
            </span>
          </span>
        </Link>
      ))}
    </main>
  );
}

export function Loading() {
  return (
    <main className="screen">
      <p role="status">{t.loading}</p>
    </main>
  );
}

export function Failure({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <main className="screen stack">
      <p className="error" role="alert">
        {text}
      </p>
      <button type="button" className="btn" onClick={onRetry ?? (() => window.location.reload())}>
        {t.retry}
      </button>
    </main>
  );
}

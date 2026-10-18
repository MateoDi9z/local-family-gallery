// Galería de un lugar (agrupada por viaje), detalle de un viaje y línea de tiempo de viajes.
import { endpoints, type MediaItem, MediaPage, Place, PlaceDetail, Trip, TripDetail } from "@lfg/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { api, errorText } from "../api/client";
import { useApi } from "../api/hooks";
import { castItems, castState, isIOS } from "../cast";

import { DeletePlace } from "../components/DeletePlace";
import { Grid, type Group } from "../components/Grid";
import { Icon } from "../components/icons";
import { MemberDots } from "../components/MemberDots";
import { MemberFilter, useMemberFiltered } from "../components/MemberFilter";
import { MergeTrip } from "../components/MergeTrip";
import { useSelection } from "../components/Selection";
import { TripMembers } from "../components/TripMembers";
import { openViewer } from "../components/viewer";
import { groupByDate, groupByDay, groupByPlace } from "../grouping";
import { formatDate, formatDay, formatShortDate, t } from "../i18n";
import { Link, navigate, usePath } from "../router";
import { useStore } from "../store";

const tripDates = (tr: { startAt: string; endAt: string }) =>
  t.trips.dates(formatDate(tr.startAt), formatDate(tr.endAt));

function DayTitle({ day, date, sub }: { day: number; date: string; sub: string }) {
  const label = date ? formatDay(date) : t.photos.noDate;
  return (
    <>
      <h2 title={day > 0 ? `${t.trips.day(day)} · ${label}` : label}>
        {day > 0 && <span className="day-badge">{t.trips.day(day)}</span>}
        {label}
      </h2>
      <span className="muted">{sub}</span>
    </>
  );
}

function PlaceTitle({ name, count }: { name: string; count: number }) {
  return (
    <h3 title={name}>
      <Icon name="place" size={18} />
      <span>{name}</span>
      <span className="muted"> · {t.gallery.count(count)}</span>
    </h3>
  );
}

function GroupTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h2 title={title}>{title}</h2>
      <span className="muted">{sub}</span>
    </>
  );
}

/** Chromecast pasa todo en la tele; en iPhone se abre la presentación para verla con AirPlay. */
function CastButton({ items }: { items: MediaItem[] }) {
  const { available } = useStore(castState);
  const ios = isIOS();
  if ((!available && !ios) || items.length === 0) return null;
  return (
    <button
      type="button"
      className="btn small"
      aria-label={t.trips.slideshow}
      onClick={() => (ios ? openViewer(items, 0, { present: true }) : castItems(items, 0, true))}
    >
      <Icon name="tv" />
      <span>{t.trips.slideshowShort}</span>
    </button>
  );
}

export function PlaceGallery({ id }: { id: string }) {
  const { data, error, reload } = useApi(endpoints.place(id), PlaceDetail);
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
  const visible = filtered.flatMap((g) => g.items);
  const bulk = useSelection(visible, data?.place.count ?? 0, (allGone) => (allGone ? navigate("/") : reload()));
  if (error) return <Failure text={error} />;
  if (!data) return <Loading />;
  return (
    <main className="screen">
      <Link href="/" className="btn link">
        {t.back}
      </Link>
      <h1 className="page-title">{data.place.name}</h1>
      <p className="muted page-sub">{t.gallery.count(data.place.count)}</p>
      <MemberFilter />
      <div className="toolbar">
        <CastButton items={visible} />
        {bulk.button}
      </div>
      <Grid groups={filtered} onOpen={(items, i) => openViewer(items, i, { onDeleted: reload })} {...bulk.gridProps} />
      {bulk.bar}
      <DeletePlace place={data.place} />
    </main>
  );
}

export function TripGallery({ id }: { id: string }) {
  const { data, error, reload } = useApi(endpoints.trip(id), TripDetail);
  const places = useApi(endpoints.places, Places);
  // El filtro de persona va antes de agrupar: así no quedan días ni lugares vacíos.
  const all = useMemo(() => [{ items: data?.media ?? [] }], [data]);
  const visible = useMemberFiltered(all)[0]?.items ?? [];
  // Un encabezado por día («Día 1 · 14/5/26»). Con un solo lugar, el lugar va en el encabezado; con varios,
  // adentro del día va un subtítulo por lugar, en el orden en que se visitaron.
  const filtered = useMemo<Group[]>(() => {
    const names = new Map((places.data ?? []).map((p) => [p.id, p.name]));
    const placeName = (id: string | null) => (id ? names.get(id) : null) ?? t.photos.noPlace;
    return groupByDay(visible).flatMap((d): Group[] => {
      const count = t.gallery.count(d.items.length);
      if (d.places.length === 1) {
        const only = d.places[0] as (typeof d.places)[number];
        const sub = only.placeId ? `${placeName(only.placeId)} · ${count}` : count;
        return [{ key: d.key, title: <DayTitle day={d.day} date={d.date} sub={sub} />, items: d.items }];
      }
      return [
        {
          key: d.key,
          title: <DayTitle day={d.day} date={d.date} sub={t.trips.dayPlaces(count, d.places.length)} />,
          items: [],
          headerOnly: true,
        },
        ...d.places.map((p) => ({
          key: `${d.key}-${p.placeId ?? "sin-lugar"}`,
          title: <PlaceTitle name={placeName(p.placeId)} count={p.items.length} />,
          items: p.items,
          small: true,
        })),
      ];
    });
  }, [visible, places.data]);
  const bulk = useSelection(visible, data?.trip.count ?? 0, (allGone) => (allGone ? navigate("/viajes") : reload()));
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
          <div className="title-row">
            <h1 className="page-title">{data.trip.name}</h1>
            <button
              type="button"
              className="icon-btn"
              aria-label={t.trips.rename}
              title={t.trips.rename}
              onClick={() => {
                setName(data.trip.name);
                setEditing(true);
              }}
            >
              <Icon name="edit" />
            </button>
          </div>
          <p className="muted page-sub">
            {t.trips.dates(formatShortDate(data.trip.startAt), formatShortDate(data.trip.endAt))} ·{" "}
            {t.gallery.count(data.trip.count)}
          </p>
          <TripMembers trip={data.trip} onChanged={reload} />
        </>
      )}
      <MemberFilter />
      <div className="toolbar">
        <CastButton items={visible} />
        {bulk.button}
        <MergeTrip
          trip={data.trip}
          onDone={(tripId) =>
            tripId === data.trip.id ? reload() : navigate(`/viaje/${encodeURIComponent(tripId)}`, true)
          }
        />
      </div>
      <Grid groups={filtered} onOpen={(items, i) => openViewer(items, i, { onDeleted: reload })} {...bulk.gridProps} />
      {bulk.bar}
    </main>
  );
}

const Trips = z.array(Trip);

type View = "viajes" | "fecha" | "lugar";
const VIEWS: View[] = ["viajes", "fecha", "lugar"];

/** Pestaña Viajes: los viajes detectados, o todas las fotos agrupadas por fecha o por lugar. */
export function Timeline() {
  const ver = new URLSearchParams(usePath().split("?")[1]).get("ver");
  const view: View = VIEWS.find((v) => v === ver) ?? "viajes";
  return (
    <main className="screen stack">
      <h1>{t.trips.title}</h1>
      <fieldset className="chips" style={{ border: 0, margin: 0 }}>
        <legend className="sr-only">{t.photos.viewLabel}</legend>
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            className="chip"
            aria-pressed={view === v}
            onClick={() => navigate(v === "viajes" ? "/viajes" : `/viajes?ver=${v}`, true)}
          >
            {t.photos.views[v]}
          </button>
        ))}
      </fieldset>
      {view === "viajes" ? <TripList /> : <PhotoGroups by={view} />}
    </main>
  );
}

function TripList() {
  const { data, error } = useApi(endpoints.trips, Trips);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p role="status">{t.loading}</p>;
  const sorted = [...data].sort((a, b) => b.startAt.localeCompare(a.startAt));
  return (
    <>
      {sorted.length === 0 && <p className="notice">{t.trips.empty}</p>}
      {sorted.map((tr) => (
        <Link key={tr.id} href={`/viaje/${encodeURIComponent(tr.id)}`} className="card trip-card">
          {tr.coverThumbUrl ? <img src={tr.coverThumbUrl} alt="" loading="lazy" /> : <span className="ph" />}
          <span>
            <h2>{tr.name}</h2>
            <span className="muted">
              {t.trips.dates(formatShortDate(tr.startAt), formatShortDate(tr.endAt))} · {t.gallery.count(tr.count)}
            </span>
            <MemberDots ids={tr.memberIds} />
          </span>
        </Link>
      ))}
    </>
  );
}

/** Todas las fotos, de a 500. shortcut: las trae todas a memoria; con más de ~20 000, agrupar en el servidor. */
function useAllMedia() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick fuerza la recarga.
  useEffect(() => {
    let alive = true;
    (async () => {
      const all: MediaItem[] = [];
      let cursor: string | null = null;
      do {
        const q = new URLSearchParams({ limit: "500", ...(cursor ? { cursor } : {}) });
        const page = await api.get(`${endpoints.media}?${q}`, MediaPage);
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && alive);
      if (alive) setItems(all);
    })().catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [tick]);
  return { items, error, reload: useCallback(() => setTick((n) => n + 1), []) };
}

const Places = z.array(Place);

function PhotoGroups({ by }: { by: "fecha" | "lugar" }) {
  const { items, error, reload } = useAllMedia();
  const places = useApi(endpoints.places, Places);
  const groups = useMemo<Group[]>(() => {
    const names = new Map((places.data ?? []).map((p) => [p.id, p.name]));
    return (items ? (by === "fecha" ? groupByDate(items) : groupByPlace(items)) : []).map((g) => {
      const dates = g.startAt && g.endAt ? tripDates({ startAt: g.startAt, endAt: g.endAt }) : t.photos.noDate;
      const place = g.placeId ? names.get(g.placeId) : null;
      return {
        key: g.key,
        title: (
          <GroupTitle
            title={place ?? (by === "fecha" ? dates : t.photos.noPlace)}
            sub={`${place || by === "lugar" ? `${dates} · ` : ""}${t.gallery.count(g.items.length)}`}
          />
        ),
        items: g.items,
      };
    });
  }, [items, by, places.data]);
  const filtered = useMemberFiltered(groups);
  const visible = filtered.flatMap((g) => g.items);
  const bulk = useSelection(visible, items?.length ?? 0, reload);
  if (error) return <p className="error">{error}</p>;
  if (!items) return <p role="status">{t.loading}</p>;
  return (
    <>
      <p className="muted">{t.photos.help[by]}</p>
      <MemberFilter />
      <div className="toolbar">
        <CastButton items={visible} />
        {bulk.button}
      </div>
      <Grid groups={filtered} onOpen={(its, i) => openViewer(its, i, { onDeleted: reload })} {...bulk.gridProps} />
      {bulk.bar}
    </>
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

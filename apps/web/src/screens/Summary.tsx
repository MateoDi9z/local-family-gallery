import { BatchSummary, endpoints, Place } from "@lfg/shared";
import { z } from "zod";
import { useApi } from "../api/hooks";
import { LocationFixer } from "../components/LocationFixer";
import { useLiveReload } from "../components/useLiveReload";
import { t } from "../i18n";
import { Link } from "../router";
import { Failure, Loading } from "./Galleries";

const Places = z.array(Place);

export function Summary({ id }: { id: string }) {
  const { data, error, reload } = useApi(endpoints.batchSummary(id), BatchSummary);
  const { data: places } = useApi(data?.places.length ? endpoints.places : null, Places);
  useLiveReload((data?.processingCount ?? 1) > 0, reload);
  if (error && !data) return <Failure text={error} />;
  if (!data) return <Loading />;

  const main = data.places[0];
  const mainAt = main && places?.find((p) => p.id === main.placeId);
  return (
    <main className="screen stack">
      <h1>{t.summary.title}</h1>
      <div className="card stack" data-testid="summary">
        <p className="big-number">{t.summary.uploaded(data.newCount, main?.name ?? null)}</p>
        {data.duplicateCount > 0 && <p>{t.summary.duplicates(data.duplicateCount)}</p>}
        {data.processingCount > 0 && (
          <p className="muted" role="status">
            {t.summary.processing(data.processingCount)}
          </p>
        )}
        {data.places.length > 1 && (
          <p className="muted">{data.places.map((p) => `${p.name} (${p.count})`).join(" · ")}</p>
        )}
      </div>
      {data.noLocation.length > 0 ? (
        <>
          <h2>{t.summary.noLocation(data.noLocation.length)}</h2>
          <LocationFixer
            items={data.noLocation}
            onChanged={reload}
            quickPlace={mainAt ? { name: mainAt.name, at: { lat: mainAt.lat, lon: mainAt.lon } } : null}
          />
        </>
      ) : (
        data.processingCount === 0 && <p>{t.summary.allLocated}</p>
      )}
      <Link href="/" className="btn primary big">
        {t.summary.toMap}
      </Link>
    </main>
  );
}

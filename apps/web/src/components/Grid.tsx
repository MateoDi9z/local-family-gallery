// Grilla virtualizada y agrupada (por viaje): solo existen en el DOM las filas visibles.
import type { MediaItem } from "@lfg/shared";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";

export type Group = {
  key: string;
  title?: ReactNode;
  items: MediaItem[];
  /** Subtítulo chico (un lugar dentro de un día). */
  small?: boolean;
  /** Se muestra aunque no tenga fotos propias (el día, cuando las fotos van en sus lugares). */
  headerOnly?: boolean;
};
type Row = { kind: "head"; group: Group } | { kind: "items"; items: MediaItem[]; first: number };

const GAP = 4;
const HEAD = 84;
const SMALL_HEAD = 44;

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(360);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function Grid({
  groups,
  onOpen,
  selected,
  onToggle,
}: {
  groups: Group[];
  onOpen?: (flat: MediaItem[], index: number) => void;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const cols = Math.max(3, Math.floor(width / 150));
  const tile = (width - GAP * (cols - 1)) / cols;

  const { rows, flat } = useMemo(() => {
    const rows: Row[] = [];
    const flat: MediaItem[] = [];
    for (const g of groups) {
      if (g.items.length === 0 && !g.headerOnly) continue;
      if (g.title) rows.push({ kind: "head", group: g });
      for (let i = 0; i < g.items.length; i += cols) {
        rows.push({ kind: "items", items: g.items.slice(i, i + cols), first: flat.length + i });
      }
      flat.push(...g.items);
    }
    return { rows, flat };
  }, [groups, cols]);

  const v = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => {
      const r = rows[i];
      return r?.kind === "head" ? (r.group.small ? SMALL_HEAD : HEAD) : tile + GAP;
    },
    overscan: 3,
    scrollMargin: ref.current?.offsetTop ?? 0,
  });

  if (flat.length === 0) return <p className="notice">{t.gallery.empty}</p>;

  return (
    <div ref={ref} style={{ position: "relative", height: v.getTotalSize() }} data-testid="grid">
      {v.getVirtualItems().map((vr) => {
        const row = rows[vr.index];
        if (!row) return null;
        return (
          <div
            key={vr.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: vr.size,
              transform: `translateY(${vr.start - v.options.scrollMargin}px)`,
            }}
          >
            {row.kind === "head" ? (
              <div className={row.group.small ? "group-head small" : "group-head"}>{row.group.title}</div>
            ) : (
              <div className="grid-row" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                {row.items.map((m, j) => (
                  <Tile
                    key={m.id}
                    m={m}
                    pressed={selected ? selected.has(m.id) : undefined}
                    onClick={() => (onToggle ? onToggle(m.id) : onOpen?.(flat, row.first + j))}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Tile({ m, onClick, pressed }: { m: MediaItem; onClick: () => void; pressed?: boolean }) {
  const label = m.originalName;
  return (
    <button
      type="button"
      className="tile"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={t.gallery.open(label)}
      data-testid="tile"
    >
      {m.thumbUrl ? (
        <img src={m.thumbUrl} alt="" loading="lazy" decoding="async" width={400} height={400} />
      ) : (
        <span>{t.gallery.processing}</span>
      )}
      {m.kind === "video" && <span className="tag">{t.gallery.video}</span>}
    </button>
  );
}

import { expect, test } from "bun:test";
import type { MediaItem } from "@lfg/shared";
import { groupByDate, groupByPlace } from "./grouping";

const H = 3600_000;
const T0 = Date.parse("2024-03-10T12:00:00Z");
const m = (id: string, hoursAgo: number | null, placeId: string | null) =>
  ({ id, takenAt: hoursAgo === null ? null : new Date(T0 - hoursAgo * H).toISOString(), placeId }) as MediaItem;

// De la más nueva a la más vieja, como las da /media.
const items = [
  m("a", 0, "miami"),
  m("b", 20, "miami"),
  m("c", 50, "orlando"), // 30 h después de b: mismo viaje
  m("x", null, null),
  m("d", 100, "casa"), // 50 h: otra salida
  m("e", 300, null), // sola
];

test("por fecha: juntas si hay 36 h o menos entre una y la siguiente; las sin fecha, al final", () => {
  const g = groupByDate(items);
  expect(g.map((x) => x.items.map((i) => i.id))).toEqual([["a", "b", "c"], ["d"], ["e"], ["x"]]);
  expect(g[0]).toMatchObject({ placeId: "miami", startAt: items[2]?.takenAt, endAt: items[0]?.takenAt });
  expect(g[3]).toMatchObject({ key: "d-sin-fecha", startAt: null, endAt: null });
  expect(groupByDate([])).toEqual([]);
});

test("por lugar: una ciudad por grupo, la más reciente primero y sin lugar al final", () => {
  const g = groupByPlace(items);
  expect(g.map((x) => [x.placeId, x.items.map((i) => i.id)])).toEqual([
    ["miami", ["a", "b"]],
    ["orlando", ["c"]],
    ["casa", ["d"]],
    [null, ["x", "e"]],
  ]);
});

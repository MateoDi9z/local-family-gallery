import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { iconPng } from "./icons";

test("iconPng genera un PNG válido del tamaño pedido", () => {
  const png = iconPng(48);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer);
  expect(dv.getUint32(16)).toBe(48);
  expect(dv.getUint32(20)).toBe(48);
  const idatLen = dv.getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  expect(raw.length).toBe(48 * (48 * 3 + 1));
  // Centro: globo claro; esquina: fondo terracota.
  const px = (x: number, y: number) => [...raw.subarray(y * 145 + 1 + x * 3, y * 145 + 4 + x * 3)];
  expect(px(0, 47)[0]).toBeGreaterThan(px(0, 47)[2] as number);
  expect(px(20, 20).every((c) => c > 200)).toBe(true);
});

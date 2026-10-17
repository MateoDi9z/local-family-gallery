import { afterEach, expect, test } from "bun:test";
import { addMedia, addMember, type TestEnv, testEnv } from "../worker/testing";
import { dhashFromRaw, hamming, hashToHex, nearlyConstant } from "./images";
import { findSimilar } from "./pipeline";

let env: TestEnv;
afterEach(() => env?.cleanup());

test("dHash desde píxeles crudos en gris y RGB", () => {
  // Gradiente horizontal creciente: cada píxel < el de su derecha → 64 bits en 1.
  const grey = new Uint8Array(72).map((_, i) => (i % 9) * 20);
  expect(dhashFromRaw(grey)).toBe(0xffffffffffffffffn);
  const rgb = new Uint8Array(72 * 3).map((_, i) => 200 - (Math.floor(i / 3) % 9) * 20);
  expect(dhashFromRaw(rgb)).toBe(0n);
  expect(() => dhashFromRaw(new Uint8Array(10))).toThrow();
  expect(hashToHex(0xabcn)).toBe("0000000000000abc");
});

test("Hamming y hashes casi constantes", () => {
  expect(hamming(0n, 0xffffffffffffffffn)).toBe(64);
  expect(hamming(0b1011n, 0b0001n)).toBe(2);
  expect(nearlyConstant(0n)).toBe(true);
  expect(nearlyConstant(0xffn)).toBe(true); // 8 en 1
  expect(nearlyConstant(0x1ffn)).toBe(false); // 9 en 1
  expect(nearlyConstant(0xffffffffffffff00n)).toBe(true); // 8 en 0
  expect(nearlyConstant(0x0f0f0f0f0f0f0f0fn)).toBe(false);
});

test("find_similar: Hamming ≤ 6 dentro de ±10 min, media_a < media_b, sin duplicar", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const base = 0x0f0f0f0f0f0f0f0fn;
  const t = (min: number) => new Date(Date.UTC(2023, 6, 14, 10, 30 + min)).toISOString();
  const add = (h: bigint, min: number) => addMedia(env.db, p, { phash: hashToHex(h), taken_at: t(min) });
  const m = add(base, 0);
  const cerca = add(base ^ 0b111111n, 5); // distancia 6
  add(base ^ (0b1111111n << 20n), 5); // distancia 7: no
  add(base, -11); // fuera de la ventana
  add(0n, 1); // casi constante: no
  expect(findSimilar(env.db, m)).toBe(1);
  expect(findSimilar(env.db, m)).toBe(0);
  expect(findSimilar(env.db, cerca)).toBe(0); // el mismo par visto desde el otro lado
  const pairs = env.db.query<{ media_a: string; media_b: string; distance: number; status: string }, []>(
    "SELECT media_a, media_b, distance, status FROM similar_pairs",
  );
  const [a, b] = [m, cerca].sort();
  expect(pairs.all()).toEqual([{ media_a: a as string, media_b: b as string, distance: 6, status: "pending" }]);
});

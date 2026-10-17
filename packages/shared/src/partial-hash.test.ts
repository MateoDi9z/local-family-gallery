import { expect, test } from "bun:test";
import { partialHash } from "./partial-hash";

const MIB = 1024 * 1024;
const sha = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const be64 = (n: number) => {
  const h = new Uint8Array(8);
  new DataView(h.buffer).setBigUint64(0, BigInt(n));
  return h;
};
const concat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of xs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

test("archivo chico: tamaño + archivo entero", async () => {
  const data = new TextEncoder().encode("hola");
  expect(await partialHash(new Blob([data]))).toBe(sha(concat(be64(4), data)));
  // vector fijo: si cambia, el cliente y el servidor dejan de coincidir
  expect(await partialHash(new Blob([]))).toBe("af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc");
});

test("archivo grande: primer y último MiB", async () => {
  const data = new Uint8Array(3 * MIB + 7).map((_, i) => i % 251);
  const expected = sha(concat(be64(data.length), data.subarray(0, MIB), data.subarray(data.length - MIB)));
  expect(await partialHash(new Blob([data]))).toBe(expected);
});

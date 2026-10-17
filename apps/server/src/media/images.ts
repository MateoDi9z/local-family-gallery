// Imágenes con la CLI de libvips (DECISIONES, "E0 · Imágenes" y "E0 · dHash").
import { type RunOptions, run, runBytes } from "./exec";

/**
 * Derivado WebP sin metadata (`keep=none`) y en sRGB. `size` es la geometría de vipsthumbnail:
 * "400x" = 400 de ancho; "2048>" = caja de 2048 sin agrandar. Rutas absolutas siempre.
 * Devuelve las dimensiones del resultado.
 */
export async function webpThumbnail(
  input: string,
  output: string,
  size: string,
  opts?: RunOptions,
): Promise<{ width: number; height: number }> {
  await run(["vipsthumbnail", input, "--size", size, "--export-profile", "srgb", "-o", `${output}[Q=80,keep=none]`], {
    timeoutMs: 120_000,
    ...opts,
  });
  return imageSize(output);
}

export async function imageSize(path: string): Promise<{ width: number; height: number }> {
  const out = await run(["vipsheader", path], { timeoutMs: 30_000 });
  const m = /:\s*(\d+)x(\d+)/.exec(out);
  if (!m) throw new Error("vipsheader: no se pudieron leer las dimensiones");
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** dHash de 64 bits a partir de los 9x8 píxeles crudos (1 a 4 bandas de 8 bits). */
export function dhashFromRaw(px: Uint8Array): bigint {
  const b = px.length / 72;
  if (![1, 2, 3, 4].includes(b)) throw new Error(`dHash: esperaba 9x8 píxeles, vinieron ${px.length} bytes`);
  const g = (i: number) =>
    b < 3
      ? (px[i * b] as number)
      : 0.299 * (px[i * b] as number) + 0.587 * (px[i * b + 1] as number) + 0.114 * (px[i * b + 2] as number);
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (g(y * 9 + x) < g(y * 9 + x + 1) ? 1n : 0n);
  return h;
}

/** dHash de NUESTRA miniatura (nunca del original): un spawn, raw a stdout. */
export async function dhash(thumbPath: string, opts?: RunOptions): Promise<bigint> {
  const px = await runBytes(["vips", "thumbnail", thumbPath, ".raw", "9", "--height", "8", "--size", "force"], {
    timeoutMs: 30_000,
    ...opts,
  });
  return dhashFromRaw(px);
}

export const hashToHex = (h: bigint) => h.toString(16).padStart(16, "0");

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Cielos, paredes, fotos negras: ≤ 8 bits en 1 o en 0. No sirven para sugerir parecidos. */
export const nearlyConstant = (h: bigint) => {
  const ones = hamming(h, 0n);
  return ones <= 8 || ones >= 56;
};

// Íconos de la PWA: la fuente es este dibujo (SVG para el navegador, PNG 192/512 generados en el
// build). Nada de PNG en el repo: la guardia del repo público los bloquea a propósito.
import { deflateSync } from "node:zlib";

const BG: Rgb = [185, 66, 11];
const BG_TOP: Rgb = [232, 112, 40];
const GLOBE: Rgb = [255, 243, 224];
const LINE: Rgb = [185, 66, 11];
type Rgb = [number, number, number];

const R = 0.3; // radio del globo (en unidades del ícono)
const W = 0.024; // grosor de las líneas

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${BG_TOP})"/><stop offset="1" stop-color="rgb(${BG})"/></linearGradient></defs>
<rect width="512" height="512" fill="url(#g)"/>
<circle cx="256" cy="256" r="${R * 512}" fill="rgb(${GLOBE})"/>
<g fill="none" stroke="rgb(${LINE})" stroke-width="${W * 512}">
<ellipse cx="256" cy="256" rx="${0.12 * 512}" ry="${R * 512}"/>
<line x1="${(0.5 - R) * 512}" y1="256" x2="${(0.5 + R) * 512}" y2="256"/>
<line x1="${(0.5 - Math.sqrt(R * R - 0.15 * 0.15)) * 512}" y1="${0.35 * 512}" x2="${(0.5 + Math.sqrt(R * R - 0.15 * 0.15)) * 512}" y2="${0.35 * 512}"/>
<line x1="${(0.5 - Math.sqrt(R * R - 0.15 * 0.15)) * 512}" y1="${0.65 * 512}" x2="${(0.5 + Math.sqrt(R * R - 0.15 * 0.15)) * 512}" y2="${0.65 * 512}"/>
</g></svg>`;

/** Color del ícono en (x, y) ∈ [0,1]², el mismo dibujo que el SVG. */
function color(x: number, y: number): Rgb {
  const dx = x - 0.5;
  const dy = y - 0.5;
  if (dx * dx + dy * dy > R * R) return BG_TOP.map((c, i) => c + ((BG[i] as number) - c) * y) as Rgb;
  const onH = [0.35, 0.5, 0.65].some((ly) => Math.abs(y - ly) < W / 2);
  // Meridiano: elipse de semiejes 0.12 × R; distancia aproximada al borde.
  const e = Math.sqrt((dx / 0.12) ** 2 + (dy / R) ** 2);
  const onE = Math.abs(e - 1) * Math.min(0.12, Math.abs(dx) + 0.02) < W / 2;
  return onH || onE ? LINE : GLOBE;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** PNG RGB de `size`×`size`, con suavizado por supermuestreo 3×3. */
export function iconPng(size: number): Uint8Array {
  const raw = new Uint8Array(size * (size * 3 + 1));
  const S = 3;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filtro "None"
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const c = color((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      const n = S * S;
      raw[row + 1 + x * 3] = Math.round(r / n);
      raw[row + 1 + x * 3 + 1] = Math.round(g / n);
      raw[row + 1 + x * 3 + 2] = Math.round(b / n);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const ICON_SIZES = [192, 512] as const;

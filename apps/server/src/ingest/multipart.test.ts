import { expect, test } from "bun:test";
import { parseMultipart } from "./multipart";

const enc = new TextEncoder();
const bin = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x0d, 0x0a, 0x2d, 0x2d, 0x80, 0xfe]);
const body = (boundary: string, parts: [string, Uint8Array][]) =>
  new Uint8Array(
    Buffer.concat([
      ...parts.flatMap(([head, data]) => [enc.encode(`--${boundary}\r\n${head}\r\n\r\n`), data, enc.encode("\r\n")]),
      enc.encode(`--${boundary}--\r\n`),
    ]),
  );

test("multipart: bytes intactos, con y sin filename, y boundary entre comillas", () => {
  const b = "----lfg";
  const raw = body(b, [
    ['Content-Disposition: form-data; name="file"', bin],
    ['Content-Disposition: form-data; name="file"; filename="IMG_0001.HEIC"\r\nContent-Type: image/heic', bin],
    ['Content-Disposition: form-data; name="nota"', enc.encode("hola")],
  ]);
  for (const ct of [`multipart/form-data; boundary=${b}`, `multipart/form-data; boundary="${b}"; charset=utf-8`]) {
    const parts = parseMultipart(raw, ct);
    expect(parts.map((p) => [p.name, p.filename, [...p.data]])).toEqual([
      ["file", "", [...bin]],
      ["file", "IMG_0001.HEIC", [...bin]],
      ["nota", "", [...enc.encode("hola")]],
    ]);
  }
  expect(parseMultipart(raw, "multipart/form-data")).toEqual([]);
  expect(parseMultipart(enc.encode("basura"), `multipart/form-data; boundary=${b}`)).toEqual([]);
});

// Multipart leído a mano para el Atajo de iOS. `Request.formData()` convierte en texto (UTF-8) toda parte
// que llega sin `filename`, y así rompe los bytes de la foto. Acá cada parte queda con sus bytes tal cual.

export type Part = { name: string; filename: string; data: Uint8Array };

/** Partes de un body `multipart/form-data`. Las vistas apuntan al mismo buffer: no se copia nada. */
export function parseMultipart(body: Uint8Array, contentType: string): Part[] {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = m?.[1] ?? m?.[2];
  if (!boundary) return [];
  const buf = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const open = Buffer.from(`--${boundary}`);
  const next = Buffer.from(`\r\n--${boundary}`);
  const parts: Part[] = [];
  let at = buf.indexOf(open);
  while (at !== -1) {
    const afterDelim = at + open.length;
    // `--boundary--` cierra el body.
    if (buf[afterDelim] === 0x2d && buf[afterDelim + 1] === 0x2d) break;
    const headStart = buf.indexOf("\r\n", afterDelim) + 2;
    const headEnd = buf.indexOf("\r\n\r\n", headStart);
    if (headStart < 2 || headEnd === -1) break;
    const end = buf.indexOf(next, headEnd + 4);
    if (end === -1) break;
    const disposition = /content-disposition:[^\r\n]*/i.exec(buf.toString("utf8", headStart, headEnd))?.[0] ?? "";
    parts.push({
      name: /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? "",
      filename: /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? "",
      data: buf.subarray(headEnd + 4, end),
    });
    at = end + 2;
  }
  return parts;
}

// Hash parcial del prechequeo de duplicados. El cliente y el servidor usan esta misma función.
// SHA-256 hex de: tamaño (uint64 big-endian) ‖ primer MiB ‖ último MiB. Si pesa ≤ 2 MiB, el archivo entero.
// Es solo un chequeo rápido: la verdad es el SHA-256 completo que calcula el servidor.

const MIB = 1024 * 1024;

export async function partialHash(file: Blob): Promise<string> {
  const size = file.size;
  const head = new Uint8Array(8);
  new DataView(head.buffer).setBigUint64(0, BigInt(size));
  const parts: BlobPart[] = size <= 2 * MIB ? [head, file] : [head, file.slice(0, MIB), file.slice(size - MIB, size)];
  const buf = await new Blob(parts).arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

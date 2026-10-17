// Web Share Target: el service worker guarda lo compartido en la Cache API y la app lo levanta en /compartir.
export const SHARE_CACHE = "lfg-share-inbox";
export const SHARE_PATH = "/compartir";
export const SHARE_FIELD = "files";

/** Toma (y borra) los archivos que dejó el service worker. */
export async function takeSharedFiles(): Promise<File[]> {
  if (!("caches" in window)) return [];
  const cache = await caches.open(SHARE_CACHE);
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) {
      const name = decodeURIComponent(res.headers.get("x-name") ?? "archivo");
      const lastModified = Number(res.headers.get("x-last-modified")) || Date.now();
      const blob = await res.blob();
      files.push(new File([blob], name, { type: res.headers.get("content-type") ?? "", lastModified }));
    }
    await cache.delete(req);
  }
  return files;
}

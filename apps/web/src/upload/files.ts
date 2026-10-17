// Juntar archivos de un <input> o de lo que se arrastra (archivos y carpetas enteras, recursivo).

const MEDIA_EXT = /\.(heic|heif|jpe?g|png|webp|gif|mov|mp4|m4v|3gp|avi|mkv)$/i;

export function isMedia(f: { name: string; type: string }) {
  if (f.name.startsWith(".")) return false; // .DS_Store, ._foto.jpg de macOS
  return f.type.startsWith("image/") || f.type.startsWith("video/") || MEDIA_EXT.test(f.name);
}

type Entry = FileSystemEntry;
const isFile = (e: Entry): e is FileSystemFileEntry => e.isFile;
const isDir = (e: Entry): e is FileSystemDirectoryEntry => e.isDirectory;

async function readAll(dir: FileSystemDirectoryEntry): Promise<Entry[]> {
  const reader = dir.createReader();
  const out: Entry[] = [];
  // readEntries devuelve de a tandas (≈100 en Chrome) hasta que viene vacío.
  for (;;) {
    const batch = await new Promise<Entry[]>((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

async function walk(entry: Entry, out: File[]) {
  if (isFile(entry)) {
    out.push(await new Promise<File>((res, rej) => entry.file(res, rej)));
  } else if (isDir(entry)) {
    for (const child of await readAll(entry)) await walk(child, out);
  }
}

export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items]
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.() ?? null)
    .filter((e): e is Entry => e !== null);
  if (entries.length === 0) return [...dt.files].filter(isMedia);
  const out: File[] = [];
  for (const e of entries) await walk(e, out);
  return out.filter(isMedia);
}

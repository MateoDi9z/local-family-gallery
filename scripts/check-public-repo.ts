// Guardia del repo público: bloquea medios, datos y archivos privados antes de que lleguen a GitHub.
// Uso: `bun scripts/check-public-repo.ts --staged` (hook pre-commit) o `--all` (CI y pre-push).

export const MAX_FIXTURE_BYTES = 2 * 1024 * 1024;
export const MANIFEST_PATH = "fixtures/manifest.json";

const MEDIA_EXT =
  /\.(heic|heif|jpe?g|png|webp|gif|avif|tiff?|bmp|dng|raw|cr2|cr3|nef|arw|orf|rw2|mov|mp4|m4v|avi|mkv|3gp|webm|hevc|mts)$/i;
const PRIVATE_DIRS = ["fixtures-reales/", "data/", "storage/", "uploads/"]; // en la raíz, como en .gitignore
const PRIVATE_FILE = /(^|\/)(\.env(\..+)?|.*\.(sqlite|sqlite-wal|sqlite-shm|db))$/i;

export type Entry = { path: string; bytes: Uint8Array };
/** path del fixture → sha256 hex, lo escribe el generador de fixtures. */
export type Manifest = Record<string, string>;

const sha256 = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const isBinary = (b: Uint8Array) => b.subarray(0, 8000).includes(0);

export function findViolations(entries: Entry[], manifest: Manifest, denylist: string[]): string[] {
  const out: string[] = [];
  const terms = denylist.map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const { path, bytes } of entries) {
    if (path.endsWith(".env.example")) continue;
    if (PRIVATE_DIRS.some((d) => path.startsWith(d)) || PRIVATE_FILE.test(path)) {
      out.push(`${path}: archivo privado (.env, base de datos o carpeta de datos/fotos reales)`);
      continue;
    }
    if (path.startsWith("fixtures/") && path !== MANIFEST_PATH) {
      if (bytes.length > MAX_FIXTURE_BYTES) out.push(`${path}: fixture de más de 2 MB`);
      if (manifest[path] !== sha256(bytes))
        out.push(`${path}: fixture que no figura (o no coincide) en ${MANIFEST_PATH}; regenerá con \`bun run fixtures\``);
    } else if (MEDIA_EXT.test(path)) {
      out.push(`${path}: imagen o video fuera de fixtures/`);
    }
    if (terms.length && !isBinary(bytes)) {
      const text = new TextDecoder().decode(bytes).toLowerCase();
      // Nunca imprimir el término: los logs de CI son públicos.
      if (terms.some((t) => text.includes(t))) out.push(`${path}: contiene un término de la lista privada`);
    }
  }
  return out;
}

/** Todo lo que ignora git también tiene que quedar fuera de la imagen Docker. */
export function missingDockerignore(gitignore: string, dockerignore: string): string[] {
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const docker = new Set(lines(dockerignore));
  return lines(gitignore).filter((l) => !docker.has(l));
}

function git(...args: string[]): Uint8Array {
  const r = Bun.spawnSync(["git", ...args]);
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout;
}
const names = (b: Uint8Array) => new TextDecoder().decode(b).split("\0").filter(Boolean);

async function readText(path: string): Promise<string> {
  const f = Bun.file(path);
  return (await f.exists()) ? f.text() : "";
}

if (import.meta.main) {
  const staged = process.argv.includes("--staged");
  const entries: Entry[] = staged
    ? names(git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR")).map((path) => ({
        path,
        bytes: git("show", `:${path}`),
      }))
    : await Promise.all(names(git("ls-files", "-z")).map(async (path) => ({ path, bytes: await Bun.file(path).bytes() })));

  const manifestText = staged
    ? new TextDecoder().decode(Bun.spawnSync(["git", "show", `:${MANIFEST_PATH}`]).stdout)
    : await readText(MANIFEST_PATH);
  const manifest: Manifest = manifestText ? JSON.parse(manifestText) : {};
  const denylist = [...(await readText(".denylist.local")).split("\n"), ...(process.env.PRIVATE_DENYLIST ?? "").split("\n")];

  const problems = findViolations(entries, manifest, denylist);
  for (const l of missingDockerignore(await readText(".gitignore"), await readText(".dockerignore")))
    problems.push(`.dockerignore: falta "${l}" (tiene que excluir todo lo que excluye .gitignore)`);

  if (problems.length) {
    console.error("Repo público: hay cosas que no pueden subirse.\n");
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("\nSacalas del commit (git restore --staged <archivo>) y probá de nuevo.");
    process.exit(1);
  }
  console.log(`Repo público: ${entries.length} archivo(s) revisado(s), todo en orden.`);
}

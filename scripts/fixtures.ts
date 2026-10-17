// `bun run fixtures`: genera los medios sintéticos de fixtures/ dentro de la imagen dev y escribe el manifiesto.
// En el contenedor (`--inside`) usa ffmpeg, vips, heif-enc y exiftool.
//
// Privacidad: GPS solo de monumentos públicos famosos, cámara y fechas genéricas.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { inDocker } from "./in-docker";

export const PLACES = {
  torreEiffel: { lat: 48.8584, lon: 2.2945 },
  operaSidney: { lat: -33.8568, lon: 151.2153 },
  coliseo: { lat: 41.8902, lon: 12.4922 }, // "casa" en los tests: lejos de los otros dos
} as const;

const CAMERA = "Cámara de ejemplo";
const DIR = "fixtures";
const TMP = "/tmp/lfg-fixtures";

async function sh(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  if (code !== 0) throw new Error(`${cmd[0]} falló (${code}): ${await new Response(p.stderr).text()}`);
  return new Response(p.stdout).text();
}
const exif = (file: string, ...tags: string[]) =>
  sh(["exiftool", "-q", "-overwrite_original", "-n", `-Make=${CAMERA}`, `-Model=${CAMERA}`, ...tags, file]);
const gps = (p: { lat: number; lon: number }) => [
  `-GPSLatitude=${Math.abs(p.lat)}`,
  `-GPSLatitudeRef=${p.lat < 0 ? "S" : "N"}`,
  `-GPSLongitude=${Math.abs(p.lon)}`,
  `-GPSLongitudeRef=${p.lon < 0 ? "W" : "E"}`,
];

async function generate() {
  await sh(["rm", "-rf", TMP]);
  await sh(["mkdir", "-p", TMP, DIR]);
  const out = (f: string) => join(process.cwd(), DIR, f); // absoluta: vipsthumbnail -o es relativo a la entrada

  // Escena con detalle (para que el dHash tenga contenido) en 1600x1200.
  await sh([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "mandelbrot=s=1600x1200:end_pts=1",
    "-frames:v",
    "1",
    `${TMP}/scene.png`,
  ]);
  await sh([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=1600x1200",
    "-frames:v",
    "1",
    `${TMP}/other.png`,
  ]);

  // 1. JPEG con GPS (Torre Eiffel).
  await sh(["vips", "copy", `${TMP}/scene.png`, `${out("foto-gps.jpg")}[Q=85]`]);
  await exif(
    out("foto-gps.jpg"),
    "-DateTimeOriginal=2023:07:14 10:00:00",
    "-OffsetTimeOriginal=+02:00",
    ...gps(PLACES.torreEiffel),
  );

  // 2. Parecida a la 1 (recomprimida y achicada, 5 s después): duplicado parecido, no idéntico.
  await sh(["vipsthumbnail", `${TMP}/scene.png`, "--size", "1520", "-o", `${out("foto-parecida.jpg")}[Q=60]`]);
  await exif(
    out("foto-parecida.jpg"),
    "-DateTimeOriginal=2023:07:14 10:00:05",
    "-OffsetTimeOriginal=+02:00",
    ...gps(PLACES.torreEiffel),
  );

  // 3. JPEG SIN GPS, 30 min después (como un iPhone que perdió la ubicación): recibe sugerencia.
  await sh(["vips", "copy", `${TMP}/other.png`, `${out("foto-sin-gps.jpg")}[Q=85]`]);
  await exif(out("foto-sin-gps.jpg"), "-DateTimeOriginal=2023:07:14 10:30:00", "-OffsetTimeOriginal=+02:00");

  // 4. HEIC rotado como el iPhone (JPEG con Orientation=6 → heif-enc crea la caja irot), con GPS.
  //    Gradiente horizontal + franja roja arriba a la izquierda: tras rotar, la franja queda arriba a la derecha.
  await sh(["vips", "xyz", `${TMP}/xy.v`, "1600", "1200"]);
  await sh(["vips", "extract_band", `${TMP}/xy.v`, `${TMP}/gx.v`, "0"]);
  await sh(["vips", "linear", `${TMP}/gx.v`, `${TMP}/g.v`, "0.159", "0", "--uchar"]);
  await sh(["vips", "bandjoin", `${TMP}/g.v ${TMP}/g.v ${TMP}/g.v`, `${TMP}/grey.v`]);
  await sh(["vips", "black", `${TMP}/red.v`, "300", "150", "--bands", "3"]);
  await sh(["vips", "linear", `${TMP}/red.v`, `${TMP}/redc.v`, "1 1 1", "255 0 0", "--uchar"]);
  await sh(["vips", "insert", `${TMP}/grey.v`, `${TMP}/redc.v`, `${TMP}/rot.jpg[Q=92]`, "0", "0"]);
  await sh(["exiftool", "-q", "-overwrite_original", "-n", "-Orientation=6", `${TMP}/rot.jpg`]);
  await sh(["heif-enc", "-q", "60", "-o", out("foto-rotada.heic"), `${TMP}/rot.jpg`]);
  await exif(
    out("foto-rotada.heic"),
    "-DateTimeOriginal=2023:07:15 09:00:00",
    "-OffsetTimeOriginal=+02:00",
    ...gps(PLACES.torreEiffel),
  );

  // 5. PNG sin metadata (captura de pantalla).
  await sh(["vipsthumbnail", `${TMP}/other.png`, "--size", "800", "-o", out("captura.png")]);

  // 6. Video HDR (HLG/bt2020, HEVC 10 bits) convertido DE VERDAD, con GPS en las Keys de QuickTime (Ópera de Sídney).
  await sh([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-vf",
    "format=yuv444p,zscale=tin=bt709:min=bt709:pin=bt709:rin=tv:t=arib-std-b67:m=bt2020nc:p=bt2020:r=tv:npl=100,format=yuv420p10le",
    "-c:v",
    "libx265",
    "-preset",
    "fast",
    "-crf",
    "30",
    "-tag:v",
    "hvc1",
    "-color_primaries",
    "bt2020",
    "-color_trc",
    "arib-std-b67",
    "-colorspace",
    "bt2020nc",
    "-color_range",
    "tv",
    "-x265-params",
    "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:range=limited:log-level=error",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    out("video-hdr.mov"),
  ]);
  await sh([
    "exiftool",
    "-q",
    "-overwrite_original",
    "-n",
    `-Keys:GPSCoordinates=${PLACES.operaSidney.lat} ${PLACES.operaSidney.lon} 10`,
    "-Keys:CreationDate=2023:12:31 20:00:00+11:00",
    `-Keys:Make=${CAMERA}`,
    `-Keys:Model=${CAMERA}`,
    "-QuickTime:CreateDate=2023:12:31 09:00:00",
    out("video-hdr.mov"),
  ]);

  // 7. Video SDR vertical sin GPS (MP4 H.264 con rotación en la matriz, como un Android).
  await sh([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=30:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:duration=2",
    "-c:v",
    "libx264",
    "-crf",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    `${TMP}/sdr.mp4`,
  ]);
  await sh([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-display_rotation",
    "90",
    "-i",
    `${TMP}/sdr.mp4`,
    "-c",
    "copy",
    out("video-sdr.mp4"),
  ]);
}

async function writeManifest() {
  const files = (await readdir(DIR)).filter((f) => f !== "manifest.json").sort();
  const manifest: Record<string, string> = {};
  for (const f of files) {
    const bytes = await Bun.file(join(DIR, f)).bytes();
    if (bytes.length > 2 * 1024 * 1024) throw new Error(`${f} pesa más de 2 MB`);
    manifest[`${DIR}/${f}`] = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  }
  await Bun.write(join(DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`fixtures: ${files.length} archivos en ${DIR}/ (manifiesto actualizado)`);
}

if (import.meta.main) {
  if (process.argv.includes("--inside")) {
    await generate();
    await writeManifest();
  } else {
    process.exit(await inDocker(["bun", "scripts/fixtures.ts", "--inside"]));
  }
}

import { expect, test } from "bun:test";
import { localFromUtc, parseExifDate, parseMeta } from "./exiftool";
import { parseProbe, transcodeArgs } from "./video";

// JSON de `exiftool -n -j -fast` sobre los fixtures sintéticos (copiado de una corrida real en la imagen dev).
const HEIC = {
  GPSLatitude: 48.8584,
  GPSLongitude: 2.2945,
  DateTimeOriginal: "2023:07:15 09:00:00",
  OffsetTimeOriginal: "+02:00",
  SubSecDateTimeOriginal: "2023:07:15 09:00:00+02:00",
  Make: "Cámara de ejemplo",
  Model: "Cámara de ejemplo",
  Orientation: 6,
  ImageWidth: 1600,
  ImageHeight: 1200,
};
const MOV = {
  GPSLatitude: -33.8568,
  GPSLongitude: 151.2153,
  CreationDate: "2023:12:31 20:00:00+11:00",
  CreateDate: "2023:12:31 09:00:00",
  MediaCreateDate: "0000:00:00 00:00:00",
  Make: "Cámara de ejemplo",
  Model: "Cámara de ejemplo",
  ImageWidth: 1280,
  ImageHeight: 720,
};

test("foto HEIC: fecha con zona a UTC, GPS, cámara y dimensiones de pantalla (Orientation 6 gira)", () => {
  const m = parseMeta(HEIC, "photo");
  expect(m.taken?.utc).toBe("2023-07-15T07:00:00.000Z");
  expect(m.taken?.tz).toBe("+02:00");
  expect(m.taken?.local.toISOString()).toBe("2023-07-15T09:00:00.000Z"); // hora local en campos UTC
  expect([m.lat, m.lon]).toEqual([48.8584, 2.2945]);
  expect([m.width, m.height]).toEqual([1200, 1600]);
  expect(m.orientation).toBe(6);
  expect(m.cameraMake).toBe("Cámara de ejemplo");
});

test("video: CreationDate local con zona gana sobre CreateDate UTC", () => {
  const m = parseMeta(MOV, "video");
  expect(m.taken?.utc).toBe("2023-12-31T09:00:00.000Z");
  expect(m.taken?.tz).toBe("+11:00");
  expect([m.lat, m.lon]).toEqual([-33.8568, 151.2153]);
  expect(m.orientation).toBeNull();
});

test("video: sin CreationDate usa CreateDate como UTC (zona desconocida) y descarta 0000:00:00", () => {
  const m = parseMeta({ CreateDate: "2023:12:31 09:00:00", MediaCreateDate: "0000:00:00 00:00:00" }, "video");
  expect(m.taken).toMatchObject({ utc: "2023-12-31T09:00:00.000Z", tz: null });
  expect(
    parseMeta({ CreateDate: "0000:00:00 00:00:00", MediaCreateDate: "0000:00:00 00:00:00" }, "video").taken,
  ).toBeNull();
});

test("prioridad de fechas en fotos: SubSec → DateTimeOriginal+Offset → CreateDate → GPSDateTime", () => {
  expect(parseMeta({ DateTimeOriginal: "2020:01:02 03:04:05", OffsetTimeOriginal: "-03:00" }, "photo").taken?.utc).toBe(
    "2020-01-02T06:04:05.000Z",
  );
  expect(parseMeta({ SubSecDateTimeOriginal: "2020:01:02 03:04:05.25-03:00" }, "photo").taken?.utc).toBe(
    "2020-01-02T06:04:05.250Z",
  );
  const naive = parseMeta({ CreateDate: "2020:01:02 03:04:05" }, "photo").taken;
  expect(naive).toMatchObject({ utc: "2020-01-02T03:04:05.000Z", tz: null });
  expect(parseMeta({ GPSDateTime: "2020:01:02 03:04:05Z" }, "photo").taken).toMatchObject({
    utc: "2020-01-02T03:04:05.000Z",
    tz: null,
  });
  expect(parseMeta({}, "photo").taken).toBeNull();
});

test("GPS: descarta 0,0 y fuera de rango; respaldo GPSCoordinates en videos", () => {
  expect(parseMeta({ GPSLatitude: 0, GPSLongitude: 0 }, "photo").lat).toBeNull();
  expect(parseMeta({ GPSLatitude: 91, GPSLongitude: 10 }, "photo").lat).toBeNull();
  expect(parseMeta({ GPSLatitude: 10, GPSLongitude: 181 }, "photo").lat).toBeNull();
  const v = parseMeta({ GPSCoordinates: "-33.8568 151.2153 10" }, "video");
  expect([v.lat, v.lon]).toEqual([-33.8568, 151.2153]);
});

test("parseExifDate rechaza basura", () => {
  for (const s of ["", "0000:00:00 00:00:00", "2020:13:01 00:00:00", "hola", 12]) expect(parseExifDate(s)).toBeNull();
});

test("localFromUtc vuelve a la hora local", () => {
  expect(localFromUtc("2023-12-31T09:00:00.000Z", "+11:00").toISOString()).toBe("2023-12-31T20:00:00.000Z");
  expect(localFromUtc("2023-12-31T09:00:00.000Z", null).toISOString()).toBe("2023-12-31T09:00:00.000Z");
});

test("ffprobe: rotación de la displaymatrix, duración y HDR", () => {
  const vertical = parseProbe({
    streams: [
      { codec_type: "video", width: 640, height: 360, side_data_list: [{ rotation: 90 }] },
      { codec_type: "audio" },
    ],
    format: { duration: "2.000000" },
  });
  expect(vertical).toEqual({ width: 360, height: 640, durationMs: 2000, hdr: false, hasAudio: true });
  const hdr = parseProbe({
    streams: [{ codec_type: "video", width: 1280, height: 720, color_transfer: "arib-std-b67" }],
    format: { duration: "1.5" },
  });
  expect(hdr).toMatchObject({ width: 1280, height: 720, hdr: true, hasAudio: false, durationMs: 1500 });
  expect(parseProbe({ streams: [{ codec_type: "video", color_transfer: "smpte2084" }] }).hdr).toBe(true);
});

test("conversión: tone mapping solo si es HDR, sin metadata, NVENC solo si hay", () => {
  const sdr = transcodeArgs("in", "out", { hdr: false, nvenc: false }).join(" ");
  const hdr = transcodeArgs("in", "out", { hdr: true, nvenc: true }).join(" ");
  expect(sdr).not.toContain("tonemapx");
  expect(hdr).toContain("tonemapx");
  expect(sdr).toContain("-map_metadata -1 -map_chapters -1");
  expect(sdr).toContain("libx264");
  expect(hdr).toContain("h264_nvenc");
  expect(sdr).toContain("+faststart");
});

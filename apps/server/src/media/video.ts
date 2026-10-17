// Videos con jellyfin-ffmpeg: ffprobe, poster y conversión a MP4 H.264/AAC (DECISIONES, "E0 · Video").
import { type RunOptions, run } from "./exec";

export type VideoProbe = {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hdr: boolean;
  hasAudio: boolean;
};

type ProbeJson = {
  streams?: {
    codec_type?: string;
    width?: number;
    height?: number;
    color_transfer?: string;
    duration?: string;
    tags?: Record<string, string>;
    side_data_list?: { rotation?: number }[];
  }[];
  format?: { duration?: string };
};

const HDR_TRANSFERS = new Set(["arib-std-b67", "smpte2084"]);

/** Parsea `ffprobe -print_format json -show_streams -show_format`. Ancho/alto con la rotación ya aplicada. */
export function parseProbe(j: ProbeJson): VideoProbe {
  const v = j.streams?.find((s) => s.codec_type === "video");
  const rotation = Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0);
  const turned = Math.abs(rotation) % 180 === 90;
  const w = v?.width ?? null;
  const h = v?.height ?? null;
  const dur = Number(j.format?.duration ?? v?.duration);
  return {
    width: turned ? h : w,
    height: turned ? w : h,
    durationMs: Number.isFinite(dur) && dur > 0 ? Math.round(dur * 1000) : null,
    hdr: HDR_TRANSFERS.has(v?.color_transfer ?? ""),
    hasAudio: !!j.streams?.some((s) => s.codec_type === "audio"),
  };
}

export async function probe(path: string, opts?: RunOptions): Promise<VideoProbe> {
  const out = await run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], {
    timeoutMs: 60_000,
    ...opts,
  });
  return parseProbe(JSON.parse(out) as ProbeJson);
}

// Lado corto a 1080 sin agrandar; vale para horizontal y vertical (ffmpeg ya autorrota).
const SCALE = "scale=w='if(gte(iw,ih),-2,min(1080,iw))':h='if(gte(iw,ih),min(1080,ih),-2)'";
// shortcut: peak=100 es una perilla; calibrar entre 100 y 203 con un MOV HDR real (DECISIONES E0).
const TONEMAP = "tonemapx=tonemap=bt2390:desat=0:peak=100:t=bt709:m=bt709:p=bt709:r=tv:format=yuv420p";

/** Argumentos de la conversión. `-map_metadata -1 -map_chapters -1`: la salida no lleva GPS, cámara ni fechas. */
export function transcodeArgs(input: string, output: string, o: { hdr: boolean; nvenc: boolean }): string[] {
  const vf = o.hdr ? `${SCALE},${TONEMAP}` : `${SCALE},format=yuv420p`;
  const encoder = o.nvenc
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "23", "-b:v", "0"]
    : ["-c:v", "libx264", "-crf", "22", "-preset", "medium"];
  return [
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-vf",
    vf,
    ...encoder,
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    "-color_range",
    "tv",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    output,
  ];
}

/** Un frame a ~1 s (o al medio si el video es más corto) como PNG, con tone mapping si es HDR. */
export async function extractFrame(
  input: string,
  output: string,
  o: { hdr: boolean; durationMs: number | null },
  opts?: RunOptions,
): Promise<void> {
  const at = o.durationMs && o.durationMs < 2000 ? o.durationMs / 2000 : 1;
  await run(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-ss",
      at.toFixed(3),
      "-i",
      input,
      "-frames:v",
      "1",
      "-map_metadata",
      "-1",
      ...(o.hdr ? ["-vf", TONEMAP] : []),
      "-f",
      "image2",
      "-c:v",
      "png",
      output,
    ],
    { timeoutMs: 120_000, ...opts },
  );
}

/** NVENC de verdad: un encode de 1 frame (listar encoders da falso positivo). */
export async function nvencWorks(): Promise<{ ok: boolean; reason: string }> {
  try {
    await run(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=1",
        "-frames:v",
        "1",
        "-c:v",
        "h264_nvenc",
        "-f",
        "null",
        "-",
      ],
      { timeoutMs: 20_000 },
    );
    return { ok: true, reason: "encode de prueba con h264_nvenc OK" };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}

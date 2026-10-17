import { test } from "bun:test";
import { join } from "node:path";

/** Tests que necesitan vips/exiftool/ffmpeg de la imagen: solo corren con `bun run test:media`. */
export const mediaTest = process.env.MEDIA_TESTS ? test : test.skip;

export const FIXTURES = join(import.meta.dir, "../../../fixtures");

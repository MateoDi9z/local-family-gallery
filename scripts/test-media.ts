// `bun run test:media`: todos los tests dentro de la imagen, incluidos los que necesitan vips/exiftool/ffmpeg
// (los que se saltean con `mediaTest` fuera del contenedor).
import { inDocker } from "./in-docker";

process.exit(await inDocker(["bun", "test", ...process.argv.slice(2)], { MEDIA_TESTS: "1" }));

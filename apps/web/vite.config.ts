import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { ICON_SIZES, ICON_SVG, iconPng } from "./build/icons";
import { es } from "./src/i18n/es";

const THEME = "#b9420b";
/** Única fuente del número de versión: el archivo VERSION de la raíz (0.6, 0.7…). */
const VERSION = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
const BG = "#fff8f0";

/** Íconos generados en el build (y servidos en dev): sin PNG en el repo. */
function icons(): Plugin {
  const files = (): Record<string, string | Uint8Array> => ({
    "icons/icon.svg": ICON_SVG,
    ...Object.fromEntries(ICON_SIZES.map((s) => [`icons/icon-${s}.png`, iconPng(s)])),
  });
  return {
    name: "lfg-icons",
    configureServer(server) {
      const all = files();
      server.middlewares.use((req, res, next) => {
        const body = all[(req.url ?? "").slice(1)];
        if (!body) return next();
        res.setHeader("Content-Type", typeof body === "string" ? "image/svg+xml" : "image/png");
        res.end(body);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(files())) this.emitFile({ type: "asset", fileName, source });
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    react(),
    icons(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: es.appName,
        short_name: es.appShortName,
        description: es.appDescription,
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: THEME,
        background_color: BG,
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
        share_target: {
          action: "/compartir",
          method: "POST",
          enctype: "multipart/form-data",
          params: { files: [{ name: "files", accept: ["image/*", "video/*", ".heic", ".heif", ".mov"] }] },
        },
      },
    }),
  ],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } },
  preview: { port: 4173, proxy: { "/api": "http://localhost:3000" } },
});

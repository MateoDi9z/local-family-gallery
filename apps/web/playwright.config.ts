import { defineConfig, devices } from "@playwright/test";

const android = devices["Pixel 5"];
if (!android) throw new Error("Playwright no trae el dispositivo Pixel 5");

/** Viewport de Android. El servidor lo levanta CI (o `docker compose -f docker-compose.e2e.yml`). */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: {
    ...android,
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    serviceWorkers: "block",
  },
});

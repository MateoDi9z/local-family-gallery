import { expect, test } from "bun:test";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { migrate, openDb } from "./db";
import { createLogger } from "./log";

test("GET /api/health responde y las migraciones aplican", async () => {
  const db = openDb(":memory:");
  expect(migrate(db)).toEqual(["001_init.sql"]);
  expect(migrate(db)).toEqual([]);
  const app = createApp({ db, config: loadConfig({ WEB_DIST: "/nonexistent" }), log: createLogger("error") });
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, version: "dev" });
  expect((await app.request("/api/nada")).status).toBe(404);
});

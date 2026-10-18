import { afterEach, expect, test } from "bun:test";
import { ActivityResponse, API_PREFIX } from "@lfg/shared";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { addMedia, addMember, type TestEnv, testEnv } from "../worker/testing";
import { activityRoutes } from "./activity";

let env: TestEnv;
afterEach(() => env?.cleanup());

test("actividad: lo que no está listo y qué le falta, lo que falló, y los lotes sin las repetidas", async () => {
  env = await testEnv();
  const p = addMember(env.db);
  const at = (min: number) => new Date(Date.UTC(2026, 4, 14, 10, min)).toISOString();
  const nueva = addMedia(env.db, p, { status: "processing", uploaded_at: at(5) });
  const video = addMedia(env.db, p, { status: "ready", kind: "video", uploaded_at: at(4) });
  const corriendo = addMedia(env.db, p, { status: "ready", uploaded_at: at(3) });
  const deFondo = addMedia(env.db, p, { status: "ready", uploaded_at: at(2) });
  const rota = addMedia(env.db, p, { status: "error", uploaded_at: at(1) });
  const job = env.db.query(
    "INSERT INTO jobs (id, type, media_id, priority, status, attempts, max_attempts, run_after, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 0, 3, ?, ?, ?)",
  );
  const now = at(6);
  job.run("j1", "video_transcode", video, "queued", now, now, now);
  job.run("j2", "preview", corriendo, "running", now, now, now);
  job.run("j3", "phash", corriendo, "queued", now, now, now);
  job.run("j4", "find_similar", deFondo, "queued", now, now, now);
  env.db.query("INSERT INTO batches (id, member_id, source, created_at) VALUES ('b1', ?, 'web', ?)").run(p, now);
  const item = env.db.query(
    "INSERT INTO batch_items (batch_id, media_id, duplicate, created_at) VALUES ('b1', ?, ?, ?)",
  );
  item.run(nueva, 0, now);
  item.run(video, 0, now);
  item.run(deFondo, 1, now); // ya estaba: no suma

  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set("ctx", env.ctx);
    c.set("deviceId", null);
    c.set("memberId", p);
    await next();
  });
  app.route(API_PREFIX, activityRoutes(env.ctx));
  const body = ActivityResponse.parse(await (await app.request(`${API_PREFIX}/activity`)).json());

  expect(body.processing.map((x) => [x.media.id, x.steps, x.running])).toEqual([
    [nueva, [], false],
    [video, ["video_transcode"], false],
    [corriendo, ["preview"], true],
  ]);
  expect(body.processingTotal).toBe(3);
  expect(body.failed.map((m) => m.id)).toEqual([rota]);
  expect(body.batches).toMatchObject([{ batchId: "b1", memberId: p, source: "web", total: 2, processing: 1 }]);
  expect(body.batches[0]?.items.map((m) => m.id).sort()).toEqual([nueva, video].sort());
});

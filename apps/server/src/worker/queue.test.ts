import { afterEach, expect, test } from "bun:test";
import { enqueue } from "../jobs/enqueue";
import { claim, cleanupDone, complete, fail, heartbeat, release, releaseExpired } from "./queue";
import { addMedia, addMember, type TestEnv, testEnv } from "./testing";

let env: TestEnv;
afterEach(() => env?.cleanup());

const T0 = Date.parse("2030-01-01T00:00:00.000Z");
const later = T0 + 60_000;
const job = (id: string) =>
  env.db
    .query<
      { status: string; attempts: number; run_after: string; locked_by: string | null; last_error: string | null },
      [string]
    >("SELECT status, attempts, run_after, locked_by, last_error FROM jobs WHERE id = ?")
    .get(id);

test("toma por prioridad y después por antigüedad, con lease; nadie más lo toma", async () => {
  env = await testEnv();
  const m = addMedia(env.db, addMember(env.db));
  const a = enqueue(env.db, "preview", m); // prioridad 2
  const b = enqueue(env.db, "thumb", m); // 0
  const c = enqueue(env.db, "geocode", m); // 1
  const order = [1, 2, 3].map(() => claim(env.db, "image", "w1", 60_000, later)?.id);
  expect(order).toEqual([b, c, a]);
  expect(claim(env.db, "image", "w2", 60_000, later)).toBeNull();
  const j = job(b);
  expect(j?.status).toBe("running");
  expect(j?.locked_by).toBe("w1");
  expect(j?.attempts).toBe(1);
});

test("los trabajos de video van solo al pool de videos", async () => {
  env = await testEnv();
  const m = addMedia(env.db, addMember(env.db), { kind: "video" });
  const v = enqueue(env.db, "video_transcode", m);
  expect(claim(env.db, "image", "w", 60_000, later)).toBeNull();
  expect(claim(env.db, "video", "w", 60_000, later)?.id).toBe(v);
});

test("respeta run_after", async () => {
  env = await testEnv();
  enqueue(env.db, "assign_trips", null, { delayMs: 30_000 });
  expect(claim(env.db, "image", "w", 60_000, Date.now())).toBeNull();
  expect(claim(env.db, "image", "w", 60_000, Date.now() + 31_000)).not.toBeNull();
});

test("reintentos con backoff exponencial y failed al agotarlos; la media crítica queda en error", async () => {
  env = await testEnv();
  const m = addMedia(env.db, addMember(env.db));
  const id = enqueue(env.db, "extract_metadata", m, { maxAttempts: 3 });
  let now = later;
  const delays: number[] = [];
  for (let i = 0; i < 3; i++) {
    const j = claim(env.db, "image", "w", 60_000, now);
    expect(j?.id).toBe(id);
    const r = fail(env.db, j as NonNullable<typeof j>, "w", `roto ${i}`, now);
    expect(r).toBe(i < 2 ? "retry" : "failed");
    const after = Date.parse(job(id)?.run_after as string);
    delays.push(after - now);
    now = after;
  }
  expect(delays.slice(0, 2)).toEqual([60_000, 120_000]); // 30 s · 2^intentos
  expect(job(id)?.status).toBe("failed");
  expect(job(id)?.last_error).toBe("roto 2");
  const media = env.db
    .query<{ status: string; error: string }, [string]>("SELECT status, error FROM media WHERE id = ?")
    .get(m);
  expect(media?.status).toBe("error");
  expect(media?.error).toContain("No pudimos");
});

test("un trabajo no crítico que falla no marca la media", async () => {
  env = await testEnv();
  const m = addMedia(env.db, addMember(env.db));
  enqueue(env.db, "preview", m, { maxAttempts: 1 });
  const j = claim(env.db, "image", "w", 60_000, later);
  expect(fail(env.db, j as NonNullable<typeof j>, "w", "x", later)).toBe("failed");
  expect(env.db.query<{ status: string }, [string]>("SELECT status FROM media WHERE id = ?").get(m)?.status).toBe(
    "processing",
  );
});

test("libera trabajos de un worker muerto (lease vencido) y el heartbeat lo evita", async () => {
  env = await testEnv();
  const m = addMedia(env.db, addMember(env.db));
  const a = enqueue(env.db, "thumb", m);
  const b = enqueue(env.db, "preview", m);
  claim(env.db, "image", "muerto", 60_000, later);
  claim(env.db, "image", "vivo", 60_000, later);
  heartbeat(env.db, b, "vivo", 60_000, later + 50_000);
  expect(releaseExpired(env.db, later + 70_000)).toBe(1);
  expect(job(a)?.status).toBe("queued");
  expect(job(a)?.locked_by).toBeNull();
  expect(job(b)?.status).toBe("running");
  // El worker muerto ya no puede completar lo que perdió.
  complete(env.db, a, "muerto", later + 71_000);
  expect(job(a)?.status).toBe("queued");
});

test("liberar un vencido que ya agotó intentos lo deja failed", async () => {
  env = await testEnv();
  const m = addMedia(env.db, addMember(env.db));
  const a = enqueue(env.db, "video_poster", m, { maxAttempts: 1 });
  claim(env.db, "image", "muerto", 60_000, later);
  releaseExpired(env.db, later + 61_000);
  expect(job(a)?.status).toBe("failed");
  expect(env.db.query<{ status: string }, [string]>("SELECT status FROM media WHERE id = ?").get(m)?.status).toBe(
    "error",
  );
});

test("al apagar, release devuelve el trabajo sin contar el intento", async () => {
  env = await testEnv();
  const a = enqueue(env.db, "assign_trips", null);
  claim(env.db, "image", "w", 60_000, later);
  release(env.db, a, "w", later);
  expect(job(a)).toMatchObject({ status: "queued", attempts: 0, locked_by: null });
});

test("limpia los done de más de 7 días", async () => {
  env = await testEnv();
  const a = enqueue(env.db, "assign_trips", null);
  const b = enqueue(env.db, "assign_trips", null);
  for (let i = 0; i < 2; i++) {
    const id = claim(env.db, "image", "w", 60_000, later)?.id as string;
    complete(env.db, id, "w", id === a ? T0 - 8 * 86_400_000 : T0);
  }
  expect(cleanupDone(env.db, 7 * 86_400_000, T0)).toBe(1);
  expect(job(a)).toBeNull();
  expect(job(b)?.status).toBe("done");
});

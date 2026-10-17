// Punto de entrada: `bun src/main.ts api|worker|migrate`. Misma imagen, distinto comando.
import { createApp } from "./app";
import { loadConfig } from "./config";
import type { Ctx } from "./context";
import { migrate, openDb } from "./db";
import { createLogger } from "./log";
import { syncVolumes } from "./storage";
import { runWorker } from "./worker";

const cmd = process.argv[2] ?? "api";
const config = loadConfig();
const log = createLogger(config.logLevel, { proc: cmd });
const db = openDb(config.dbPath);
const applied = migrate(db);
if (applied.length) log.info("migraciones aplicadas", { applied });
syncVolumes(db, config);
const ctx: Ctx = { db, config, log };

if (cmd === "migrate") {
  db.close();
} else if (cmd === "worker") {
  const ac = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ac.abort());
  await runWorker(ctx, ac.signal);
  db.close();
} else if (cmd === "api") {
  const app = createApp(ctx);
  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    // tus manda partes de 50 MiB (DECISIONES E0); margen para el Atajo de iOS, que sube el archivo entero.
    maxRequestBodySize: 4 * 1024 ** 3,
    idleTimeout: 120,
  });
  log.info("api escuchando", { port: server.port });
} else {
  log.error("comando desconocido", { cmd });
  process.exit(1);
}

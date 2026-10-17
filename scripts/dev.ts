export {};

// `bun run dev`: levanta api, worker y web juntos. Ctrl+C corta los tres.
const procs = [
  ["api", ["bun", "--watch", "apps/server/src/main.ts", "api"]],
  ["worker", ["bun", "--watch", "apps/server/src/main.ts", "worker"]],
  ["web", ["bun", "--bun", "vite", "--host"], "apps/web"],
] as const;

const children = procs.map(([name, cmd, cwd]) =>
  Bun.spawn([...cmd], { cwd, stdout: "inherit", stderr: "inherit", env: { ...process.env, DEV_PROC: name } }),
);
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(children.map((c) => c.exited));
stop();

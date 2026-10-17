// Corre un comando dentro de la imagen `dev` (mismas herramientas que producción), con el repo montado.
// node_modules vive en un volumen aparte: los binarios de la Mac no sirven en Linux.
export async function inDocker(cmd: string[], env: Record<string, string> = {}): Promise<number> {
  const run = async (args: string[]) => (await Bun.spawn(args, { stdout: "inherit", stderr: "inherit" }).exited) ?? 1;
  const built = await run([
    "docker",
    "build",
    "-q",
    "--target",
    "dev",
    "-t",
    "lfg-dev",
    "-f",
    "docker/app.Dockerfile",
    ".",
  ]);
  if (built !== 0) return built;
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  // --ignore-scripts: el prepare configura hooks de git y adentro no hay repositorio
  // (en un worktree, .git apunta afuera del directorio montado).
  return run([
    "docker",
    "run",
    "--rm",
    "-v",
    `${process.cwd()}:/app`,
    "-v",
    "lfg-node-modules:/app/node_modules",
    ...envArgs,
    "lfg-dev",
    "sh",
    "-c",
    `bun install --frozen-lockfile --ignore-scripts >/dev/null && ${cmd.join(" ")}`,
  ]);
}

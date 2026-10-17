// Correr herramientas externas (vips, ffmpeg, ffprobe) con timeout y cancelación.

export type RunOptions = { timeoutMs?: number; signal?: AbortSignal };

/** Corre `cmd` y devuelve stdout como bytes. Falla con el final de stderr si el código no es 0. */
export async function runBytes(cmd: string[], opts: RunOptions = {}): Promise<Uint8Array> {
  const p = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: opts.timeoutMs ?? 120_000,
    signal: opts.signal,
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).bytes(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) {
    const why = p.signalCode ? `cortado (${p.signalCode})` : `código ${code}`;
    throw new Error(`${cmd[0]} falló, ${why}: ${err.trim().slice(-500)}`);
  }
  return out;
}

export const run = async (cmd: string[], opts?: RunOptions) => new TextDecoder().decode(await runBytes(cmd, opts));

// Área medios: worker de la cola. E1: solo el punto de entrada. Lo completa el agente medios en E2.
import type { Ctx } from "../context";

export async function runWorker(ctx: Ctx, signal: AbortSignal): Promise<void> {
  ctx.log.info("worker listo");
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
}

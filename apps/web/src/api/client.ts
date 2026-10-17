// Cliente de la API: valida cada respuesta con los contratos de @lfg/shared y traduce los errores
// a lenguaje humano. Los errores de acceso (PIN, asistente, miembro) avisan al App con un evento.
import { API_PREFIX, ErrorResponse } from "@lfg/shared";
import type { z } from "zod";
import { t } from "../i18n";

export type GateCode = "pin_required" | "setup_required" | "member_required";
const GATE_CODES: string[] = ["pin_required", "setup_required", "member_required"];
export const GATE_EVENT = "lfg:gate";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const KNOWN: Record<string, string> = {
  pin_invalid: t.errors.pinWrong,
  wrong_pin: t.errors.pinWrong,
  not_found: t.errors.notFound,
  invalid: t.errors.invalid,
};

async function request<S extends z.ZodType>(method: string, path: string, schema: S | null, body?: unknown) {
  let res: Response;
  try {
    res = await fetch(API_PREFIX + path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "offline", navigator.onLine ? t.serverDown : t.errors.offline);
  }
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = ErrorResponse.safeParse(json);
    const code = err.success ? err.data.error : `http_${res.status}`;
    if (GATE_CODES.includes(code)) window.dispatchEvent(new CustomEvent(GATE_EVENT, { detail: code }));
    throw new ApiError(res.status, code, KNOWN[code] ?? (err.success ? err.data.message : t.errors.generic));
  }
  return (schema ? schema.parse(json) : undefined) as z.infer<S>;
}

export const api = {
  get: <S extends z.ZodType>(path: string, schema: S) => request("GET", path, schema),
  post: <S extends z.ZodType>(path: string, body: unknown, schema: S | null = null) =>
    request("POST", path, schema, body),
  patch: <S extends z.ZodType>(path: string, body: unknown, schema: S | null = null) =>
    request("PATCH", path, schema, body),
  del: (path: string) => request("DELETE", path, null),
};

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : t.errors.generic);

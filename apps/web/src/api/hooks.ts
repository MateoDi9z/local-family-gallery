import { endpoints, type Member, Member as MemberSchema } from "@lfg/shared";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { z } from "zod";
import { api, errorText } from "./client";

/** GET con estado de carga/error. `path = null` no pide nada. */
export function useApi<S extends z.ZodType>(path: string | null, schema: S) {
  const [data, setData] = useState<z.infer<S> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick fuerza la recarga; schema es estable.
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api
      .get(path, schema)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, reload };
}

export const MemberList = z.array(MemberSchema);
export const fetchMembers = () => api.get(endpoints.members, MemberList);

export const MembersContext = createContext<Member[]>([]);
export const useMembers = () => useContext(MembersContext);
export const useMember = (id: string | null | undefined) => useMembers().find((m) => m.id === id);

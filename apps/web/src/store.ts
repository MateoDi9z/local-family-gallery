// Estado global chico (sin librerías): un valor + suscriptores, para usar con useSyncExternalStore.
import { useSyncExternalStore } from "react";

export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((prev: T) => T)) {
      value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
      for (const s of subs) s();
    },
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

export function useStore<T>(store: ReturnType<typeof createStore<T>>) {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Filtro por miembro de las galerías (null = todos), recordado en el dispositivo. */
export const memberFilter = createStore<string | null>(localStorage.getItem("lfg.memberFilter"));
memberFilter.subscribe(() => {
  const v = memberFilter.get();
  if (v) localStorage.setItem("lfg.memberFilter", v);
  else localStorage.removeItem("lfg.memberFilter");
});

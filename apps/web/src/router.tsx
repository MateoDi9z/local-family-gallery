// Router mínimo sobre la History API: no hace falta una dependencia para cinco pantallas.
import { type AnchorHTMLAttributes, useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};
const getPath = () => window.location.pathname + window.location.search;

export function navigate(to: string, replace = false) {
  if (to === getPath()) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath() {
  return useSyncExternalStore(subscribe, getPath);
}

/** `/lugar/:id` contra `/lugar/abc` → `{ id: "abc" }`, o null si no coincide. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/");
  const s = (path.split("?")[0] ?? "").split("/");
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as string;
    const b = s[i] as string;
    if (a.startsWith(":")) params[a.slice(1)] = decodeURIComponent(b);
    else if (a !== b) return null;
  }
  return params;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
      {...rest}
    />
  );
}

# ESTADO.md

## Hecho

- 2026-10-17 · E0: los spikes de tus, Range, HEIC, dHash, GPS en MOV, HDR y Playwright funcionan. Resultados en `DECISIONES.md`; ajustes en `PLAN.md` (`[CAMBIO E0]`).
- 2026-10-17 · Guardia del repo público: `pre-commit`, `pre-push` y el workflow `guardia-repo-publico`. Agentes en `.claude/agents/`.

- 2026-10-17 · E1:
  - monorepo, contratos en `packages/shared`, migración 001 y servidor Hono (`/api/health`);
  - storage y encolado; web mínima;
  - Biome, typecheck (TS 7), CI (`ci` + guardia) en verde;
  - imagen `dev` y 7 fixtures sintéticos; skills.
  - Se arregló una carrera de migraciones entre api y worker.
- 2026-10-17 · E2 mergeada a `main`: infra, ingesta (31 tests), medios (56 + 3 de `test:media`) y la PWA.
- 2026-10-17 · E3: e2e de Android en verde contra la imagen de producción (asistente → subir `foto-gps.jpg` → globo → visor → original idéntico).
- 2026-10-17 · E4: QA contra SPEC y CLAUDE. Guardia y gitleaks en limpio. Lighthouse 11.7.1, PWA 1 (instalable) sobre el build de producción. Se agregaron `README.md` y `GUIA-FAMILIA.md` (SPEC §14).

## Falta

- Que CI quede en verde y que el workflow `images` publique en GHCR (cierra E3).
- E5: despliegue en el servidor de la casa. Hace falta Docker en ese servidor, el token de DuckDNS, las rutas de los discos y los dispositivos reales. No están en esta máquina. Pasos en `deploy/SETUP-SERVIDOR.md`.

## QA (E4)

Revisión del 2026-10-17 sobre `main`. Comandos: `bun run check:public` (160 archivos, en orden) y `gitleaks git --redact .` (26 commits, sin secretos).

| Qué dice la SPEC | Dónde | Resultado |
|---|---|---|
| Nada de fotos reales, tokens ni PIN en el repo (§6) | guardia + gitleaks | Limpio |
| Sin nombres de personas ni de lugares en código, tests o docs (§6) | ejemplos «Persona 1» y «Ciudad de ejemplo»; el GPS de los fixtures es de monumentos públicos, como pide CLAUDE.md | Limpio |
| Originales intactos; nada se borra solo (§7, §9) | `DELETE /media/:id` mueve el original a `papelera/` solo si un usuario lo pide (`apps/server/src/views/index.ts`) | Limpio |
| Documentación final (§14) | faltaban `README.md` y `GUIA-FAMILIA.md` | Corregido en este cambio |
| PWA instalable (§10, §12.5) | Lighthouse 11.7.1 contra `http://127.0.0.1:4173` (build de `vite build`) | Puntaje PWA 1: manifiesto instalable, ícono maskable, splash y viewport |
| Probar con archivos reales (§14) | `fixtures-reales/` no está | Queda para el humano |

No se encontró nada sensible ya subido.

## Cómo retomar

- `PLAN.md` marca las etapas (✅/🔄). Los worktrees de E2 siguen en `../lfg-wt/`; el código integrado está en `main`.

## Para revisar el humano

- Validar con archivos reales de iPhone en `fixtures-reales/`: un `.heic` y un `.MOV` HDR con ubicación. Los spikes y el e2e se hicieron con sintéticos. SPEC §14 pide esa prueba antes de dar el producto por cerrado del todo.
- Opcional: cargar los términos privados en `.denylist.local` (Mac) y en el secret `PRIVATE_DENYLIST` (GitHub), uno por línea: el dominio de DuckDNS, la IP pública y los nombres reales.
- E5, en el servidor de la casa (esta máquina no lo es): seguir `deploy/SETUP-SERVIDOR.md` (Docker, discos, DuckDNS, `./deploy.sh`) y probar en un Android, un iPhone, una compu y, si hay, la tele con Chromecast.

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

## Falta

- Que CI quede en verde y que el workflow `images` publique en GHCR.
- E4 (QA) y E5 (despliegue en el servidor).

## Cómo retomar

- `PLAN.md` marca las etapas (✅/🔄). Los worktrees de E2 siguen en `../lfg-wt/`; el código integrado está en `main`.

## Para revisar el humano

- Validar con archivos reales de iPhone en `fixtures-reales/`: un `.heic` y un `.MOV` HDR con ubicación. Los spikes se hicieron con sintéticos.
- Opcional: cargar los términos privados en `.denylist.local` (Mac) y en el secret `PRIVATE_DENYLIST` (GitHub), uno por línea: el dominio de DuckDNS, la IP pública y los nombres reales.

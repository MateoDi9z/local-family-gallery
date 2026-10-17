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
- 2026-10-17 · E2.frontend: PWA en español (asistente, globo, galería, visor, subida, compartir, administración). Lint y typecheck en verde. Los e2e contra el backend real quedan para E3.

## Falta

- E3: integrar `infra/e2`, `ingesta/e2`, `medios/e2` y `frontend/e2`. Correr `test:media` y los e2e.

## Cómo retomar

- `PLAN.md` marca las etapas (✅/🔄). Las ramas `infra/…`, `ingesta/…`, `medios/…` y `frontend/…` son de E2, cada una en su worktree bajo `../lfg-wt/`.

## Para revisar el humano

- Validar con archivos reales de iPhone en `fixtures-reales/`: un `.heic` y un `.MOV` HDR con ubicación. Los spikes se hicieron con sintéticos.
- Opcional: cargar los términos privados en `.denylist.local` (Mac) y en el secret `PRIVATE_DENYLIST` (GitHub), uno por línea: el dominio de DuckDNS, la IP pública y los nombres reales.

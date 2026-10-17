---
name: probar-flujo-android
description: Correr y depurar los e2e de Playwright en viewport de Android contra el backend real.
---

1. `bun run fixtures` si faltan fixtures. Los e2e usan solo `fixtures/` (nunca `fixtures-reales/`): las capturas de CI son públicas.
2. `bun run e2e` (= `bun --bun playwright test` en `apps/web`; sin `--bun` corre con Node sin avisar).
3. Los tests son `apps/web/e2e/*.e2e.ts` (no `.spec.ts`/`.test.ts`, para que `bun test` no los levante).
4. Sin baselines de `toHaveScreenshot`: asserts funcionales; `page.screenshot` solo como artefacto.
5. Si falla: mirá `apps/web/test-results/` y `playwright-report/` (gitignored).

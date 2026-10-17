---
name: release-deploy
description: Publicar una versión (imágenes en GHCR) y desplegarla en el servidor.
---

1. `main` en verde: lint, typecheck, `bun test`, `bun run test:media`, `bun run e2e`, guardia.
2. Push a `main`: el workflow de imágenes construye `linux/amd64` y publica `ghcr.io/<owner>/local-family-gallery-{app,caddy}` con `latest` y `sha-<corto>`.
3. Verificá que el workflow terminó: `gh run list --workflow images.yml --limit 1`.
4. En el servidor: `cd /opt/galeria && ./deploy.sh` (pull, up, migraciones, healthcheck). Ver `deploy/SETUP-SERVIDOR.md`.
5. Las imágenes son públicas: nunca agregues secretos, dominios ni datos al build.

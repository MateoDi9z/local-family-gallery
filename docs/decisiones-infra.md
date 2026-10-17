# Decisiones de infra (E2.infra)

Para mover a `DECISIONES.md` al mergear. Formato: **fecha — decisión.** Por qué. Alternativas.

## 2026-10-17 — Imagen prod: build y dependencias en etapas aparte

- **Decisión:** `manifests` (solo package.json + lockfile) → `build` (todas las deps + `vite build`) y `prod-deps` (`bun install --production`), las dos sobre `oven/bun` pelado; `prod` sale de `base` y copia el árbol de `prod-deps` (linker aislado: hay `node_modules` por workspace), el código de `apps/server` y `packages/shared`, y `apps/web/dist`. `bun install` va con `--ignore-scripts` porque el `prepare` configura hooks de git.
- **Por qué:** la capa de dependencias se cachea mientras no cambie el lockfile; la imagen final no lleva Vite, Playwright ni el código fuente de la web. Medido en arm64: 985 MB, 95 MB de `node_modules`.
- **Build de la web:** usa `bun run build` si `apps/web/package.json` lo tiene, si no `bun --bun vite build`.
- **Alternativas:** `bun build --compile` del servidor (un binario): descartado por ahora, tus y Hono cargan bien igual y no hay que validar el bundling.

## 2026-10-17 — GeoNames dentro de la imagen

- **Decisión:** `cities500.zip` se baja en el build (etapa `geonames`) a `/opt/geonames/cities500.txt`, con `GEONAMES_PATH` apuntando ahí.
- **Por qué:** el worker anda offline desde el primer arranque. Son datos públicos (CC BY 4.0): **hay que mostrar la atribución a GeoNames** en algún lugar de la app.
- **Alternativas:** bajarlo al primer arranque del worker (depende de internet en el servidor y de que el disco rápido tenga lugar); fijar un snapshot con SHA-256 (GeoNames lo regenera a diario, no hay URL versionada).

## 2026-10-17 — Usuario no root (UID 1000)

- **Decisión:** la imagen corre como `bun` (1000:1000, viene en `oven/bun`). Las carpetas de datos del host tienen que ser de 1000:1000; `deploy.sh` avisa si no lo son. `/data` existe en la imagen con ese dueño para que los volúmenes con nombre (e2e) nazcan escribibles.
- **Alternativas:** root (más simple con bind mounts, peor si alguien escapa del proceso); `user:` configurable en el compose (más variables para nada).

## 2026-10-17 — Discos: rutas fijas adentro del contenedor

- **Decisión:** adentro siempre `/data/fast`, `/data/bulk1`, `/data/bulk2`…; afuera `HOST_FAST_PATH` y `HOST_BULKn_PATH` en `.env`. `DATA_FAST_PATH` lo fija el compose; `DATA_BULK_PATHS` queda en `.env`. Agregar un disco = una línea en `x-data-volumes` + dos en `.env`.
- **Por qué:** la tabla `volumes` guarda la ruta del contenedor, que no cambia aunque se mueva el disco de punto de montaje en el host. Compose no puede generar montajes a partir de una lista.
- **Alternativas:** montar un único padre (`/mnt` → `/mnt`): más mágico y expone discos ajenos al contenedor.

## 2026-10-17 — GPU como archivo compose aparte

- **Decisión:** `docker-compose.gpu.yml` con `deploy.resources.reservations.devices` (nvidia, `[gpu, video]`) y `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility`. `deploy.sh` lo suma solo si `nvidia-smi` responde.
- **Por qué:** una reserva de GPU en el compose base hace fallar el `up` en un servidor sin NVIDIA. `video` es la capacidad que expone NVENC/NVDEC.

## 2026-10-17 — Migraciones en deploy.sh

- **Decisión:** `docker compose run --rm --no-deps app bun apps/server/src/main.ts migrate` antes del `up`. Si falla, no se toca lo que está corriendo.
- **Consecuencia:** durante unos segundos la versión vieja corre sobre la base ya migrada: las migraciones tienen que ser aditivas (ya lo son por regla).
- **Alternativa:** servicio `migrate` en el compose con `depends_on: service_completed_successfully`: queda un contenedor muerto en `ps` y complica el rollback.

## 2026-10-17 — Actualización automática con ONLY_IF_NEW

- **Decisión:** el timer de systemd corre `deploy.sh` con `ONLY_IF_NEW=1`: compara los IDs de imagen antes y después del pull y sale sin hacer nada si no cambiaron. Una vez por día a las 04:00 (±30 min).
- **Alternativas:** Watchtower (otro contenedor con acceso al socket de Docker y sin migraciones).

## 2026-10-17 — Caddy

- **Decisión:** `caddy:2.11.7` + `caddy-dns/duckdns@v0.5.0`. DNS-01 con `resolvers 1.1.1.1 9.9.9.9` (el DNS del router suele filtrar o cachear el TXT). Sin límite de body ni timeouts de lectura (los defaults de Caddy), `response_header_timeout 10m` hacia la app y `flush_interval -1` para SSE. Compresión solo para texto/JSON/JS/CSS/SVG/manifest (los medios y el SSE quedan afuera). Headers: HSTS, nosniff, `X-Frame-Options SAMEORIGIN`, `Referrer-Policy same-origin`, `Permissions-Policy`.
- **Sin CSP por ahora:** MapLibre (workers en blob), los tiles de OpenFreeMap y el SDK de Cast necesitan excepciones que conviene definir con el frontend terminado.
- **Verificado:** con `tls internal` en la Mac, un body de 200 MB llega a la app (sin 413), el JS sale con gzip, y HSTS y nosniff están presentes.

## 2026-10-17 — CI

- **Decisión:**
  - `media`: build del target `dev` con caché GHA (`scope=dev`) y `bun test` con `MEDIA_TESTS=1` adentro, igual que `scripts/test-media.ts` (que no se usa directo porque hace su propio `docker build` y no aprovecharía la caché de buildx).
  - `e2e`: se saltea si no existe `apps/web/e2e`; build `prod` (caché compartida con `images.yml`, `scope=app-amd64`), `docker-compose.e2e.yml up --wait`, Playwright con `E2E_BASE_URL`, reporte como artefacto por 3 días solo si falla.
  - `images.yml`: en push a `main` y a mano; matriz app/caddy, `linux/amd64`, tags `latest` y `sha-<7>`, owner en minúsculas, labels OCI, `APP_VERSION=sha-<7>`.
- **Alternativas:** `images.yml` disparado por `workflow_run` de `ci` en verde: más seguro, pero hoy `main` solo recibe merges con CI en verde.

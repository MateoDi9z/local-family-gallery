# Galería Familiar Local

Galería privada de fotos y videos de viajes. Corre en un servidor dentro de la casa: cada persona sube desde el celular o la compu, y se ve en un globo desde el celular o en la tele con Chromecast.

Qué hay que construir está en `SPEC.md`. Cómo se construyó, en `PLAN.md` y `DECISIONES.md`. Cómo usarla sin tecnicismos, en `GUIA-FAMILIA.md`. Cómo instalarla en el servidor, en `deploy/SETUP-SERVIDOR.md`.

El repo y las imágenes de GHCR son públicos. No se commitean fotos reales, tokens, PINs ni `.env`. Los ejemplos usan "Persona 1" y "Ciudad de ejemplo".

## Desarrollo

Hace falta [Bun](https://bun.sh) 1.4. En la Mac, sin GPU NVIDIA, el camino por CPU tiene que funcionar siempre.

```bash
bun install
bun run dev
```

Eso levanta la API en el puerto 3000, el worker y la web (Vite) en el 5173. Abrí `http://localhost:5173`. La primera visita muestra el asistente. Los datos quedan en `./data` (no se commitea).

Lo que usa libvips, exiftool o ffmpeg se prueba dentro de la imagen Docker, no con lo instalado en la Mac:

```bash
docker compose -f docker-compose.dev.yml up
```

Eso levanta la API y el worker con las mismas herramientas que producción. La web conviene seguirla nativa (`cd apps/web && bun --bun vite`): Vite ya hace de proxy de `/api` hacia el puerto 3000.

| Comando | Qué hace |
|---|---|
| `bun run lint` | Lint y formato (Biome) |
| `bun run typecheck` | TypeScript estricto |
| `bun test` | Tests unitarios (los de medios se saltean) |
| `bun run test:media` | Pipeline de imágenes y videos, dentro de la imagen |
| `bun run e2e` | Playwright en viewport de Android, contra el backend real |
| `bun run fixtures` | Regenera los medios sintéticos de `fixtures/` |
| `bun run db:migrate` | Aplica las migraciones de SQLite |
| `bun run check:public` | Guardia del repo público |

Antes de cada commit: `bun run lint && bun run typecheck && bun test`. Antes de mergear a `main`: además `bun run test:media` y `bun run e2e`.

## Instalación y despliegue

Las imágenes `linux/amd64` se publican solas en GHCR al pushear a `main` (`local-family-gallery-app` y `local-family-gallery-caddy`, tags `latest` y `sha-<corto>`). No se publican imágenes desde la Mac.

En el servidor (Debian o Ubuntu, dentro de la casa):

1. Seguí `deploy/SETUP-SERVIDOR.md`: Docker, GPU NVIDIA opcional, discos, dominio y HTTPS.
2. Copiá `deploy/` a `/opt/galeria`, completá `.env` a partir de `.env.example` y corré `./deploy.sh`.

`deploy.sh` baja las imágenes, aplica las migraciones, levanta Caddy, la app y el worker, y espera a que `/api/health` responda. Se puede correr las veces que haga falta.

La galería solo se abre desde la red de casa. El dominio apunta a la IP local del servidor; no hay que abrir puertos en el router.

## Agregar un disco

El disco rápido guarda la base, las miniaturas y las versiones medianas. El disco grande guarda los originales y los videos convertidos. Con un solo disco, los dos niveles pueden ser carpetas del mismo lugar.

Para sumar otro disco grande: formatearlo y montarlo por UUID, crear la carpeta con dueño `1000:1000`, agregar `HOST_BULK2_PATH` y `/data/bulk2` en `DATA_BULK_PATHS`, y una línea de volumen en `deploy/docker-compose.yml`. El paso a paso está en `deploy/SETUP-SERVIDOR.md`, sección "Agregar un disco". Lo nuevo se guarda en el disco con más espacio libre.

Para mover archivos que ya están de un disco a otro, en el servidor:

```bash
docker compose exec app bun apps/server/src/main.ts move-volume --from /data/bulk1 --to /data/bulk2
```

## Respaldo

1. Los originales, en la carpeta `originales/` de cada disco grande. Si la app desaparece, siguen en carpetas por fecha con nombres legibles.
2. La base (`HOST_FAST_PATH/db/galeria.sqlite`), en caliente con `VACUUM INTO`. El comando está en `deploy/SETUP-SERVIDOR.md`, sección "Backups".
3. El `.env`, en un gestor de contraseñas: tiene el token del dominio.

Las miniaturas y los videos convertidos se pueden regenerar.

## Problemas comunes

| Síntoma | Qué hacer |
|---|---|
| La web no conecta en desarrollo | Mirá que `bun run dev` haya dejado la API en el puerto 3000. |
| Un test de medios no corre en la Mac | Es esperado: `bun run test:media` lo corre dentro de Docker. |
| El celular no encuentra el dominio | Suele ser la protección DNS rebinding del router. Ver `deploy/SETUP-SERVIDOR.md`. |
| El certificado no es de confianza | `docker compose logs caddy` en `/opt/galeria`. Revisá el dominio y el token. |
| Los videos tardan mucho | Sin GPU NVIDIA se convierten con la CPU. Con GPU, el log del worker tiene que decir que detectó NVENC. |
| Un disco está casi lleno | Administración avisa al pasar el 85 %. Sumá otro disco (arriba). |

Más casos, en `deploy/SETUP-SERVIDOR.md`.

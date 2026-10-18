# PLAN.md — Galería Familiar Local

Plan de construcción. **`SPEC.md` define qué se construye; este archivo define cómo y en qué orden.** El agente coordinador lo mantiene actualizado: cuando una etapa termina, se marca, y cuando algo cambia, se anota en `DECISIONES.md`.

---

## 1. Hitos

| Hito | Qué incluye | Cuándo |
|---|---|---|
| **A — Primera entrega** | Prioridades 1 a 5 de SPEC §12: CI/CD + deploy, asistente, subida desde compu y celu, procesamiento, globo + galería + visor, PWA + Compartir en Android | Para mañana |
| **B — Completo** | Prioridades 6 a 8: Atajo de iOS, Chromecast, portada, sugerencias de ubicación, viajes, favoritos, duplicados parecidos, administración | Siguientes días |
| **C — Fase 2** | SPEC §13 | Más adelante |

**Regla del Hito A:** si algo se traba más de 45 minutos, se simplifica, se anota en `DECISIONES.md` y se sigue. Una versión simple que funciona le gana a una completa que no llega.

---

## 2. Etapas

Estado: ⬜ pendiente · 🔄 en curso · ✅ terminada

### E0 — Spikes de riesgo · coordinador · en serie · ✅

> [CAMBIO E0] Terminada el 2026-10-17. Todos los spikes funcionaron sin plan B; resultados y ajustes en `DECISIONES.md`. Validados con archivos **sintéticos**: HEIC, MOV HDR y GPS en MOV quedan pendientes de un archivo real de iPhone (E2.medios / E4).
Pruebas mínimas, descartables, para validar el stack antes de construir encima.

| Spike | Cómo se prueba | Plan B |
|---|---|---|
| tus sobre Bun + Hono | Subir un archivo de 500 MB con `tus-js-client`, cortar a la mitad y reanudar | Implementar el subconjunto de tus necesario (POST, HEAD, PATCH, extensión creation) |
| HEIC en `oven/bun` Debian | Contenedor con libvips + libheif: convertir un `.heic` real a WebP de 400 px respetando la orientación | sharp compilado contra libvips del sistema, o `heif-convert` + vips |
| ffmpeg + tone mapping HDR | En el contenedor, sin GPU: MOV HEVC HDR → MP4 H.264 SDR 1080p. Con `ffprobe`, chequear `color_transfer=bt709` y que no quede lavado (comparar un frame) | ffmpeg de Debian con `zscale` + `tonemap` en CPU |
| GPS en MOV | `exiftool -n -G` sobre un MOV de iPhone: leer `QuickTime:GPSCoordinates` | Leer las keys de QuickTime con ffprobe |
| Playwright bajo Bun | Correr un test trivial con viewport de Android | Correr solo los e2e con Node |

**Terminado cuando:** cada spike tiene su resultado y la opción elegida en `DECISIONES.md`, y este plan está ajustado si algo cambió.

### E1 — Cimientos · coordinador · en serie · ✅
- Monorepo con workspaces de Bun: `apps/server`, `apps/web`, `packages/shared`.
- TypeScript estricto, Biome y `bun test` configurados, más los scripts de la raíz de `CLAUDE.md`.
- `packages/shared`: todos los contratos de la §3 (esquemas zod, tipos de API y de trabajos).
- Migración inicial de la base (§3.1).
- > [CAMBIO E0] Ya hechos en E0: `.claude/agents/`, `.gitignore`, `.dockerignore` y la guardia del repo público (hooks + workflow `guardia-repo-publico`, ver CLAUDE.md "Repo público").
- `.claude/skills/` (`generar-fixtures`, `probar-flujo-android`, `release-deploy`).
- Script `bun run fixtures` funcionando. > [CAMBIO E0] Escribe `fixtures/manifest.json` (path → SHA-256); GPS de monumentos públicos, cámara y fechas genéricas; HEIC con rotación `irot` (JPEG con EXIF=6 → `heif-enc`); MOV HDR convertido de verdad a HLG (no solo etiquetado); GPS de MOV escrito con `exiftool -n`.
- CI mínimo: lint + typecheck + tests en cada PR.
- `bun run dev` levanta API, worker y web, aunque estén vacíos.

**Terminado cuando:** CI está en verde en `main`, `bun run dev` responde `GET /api/health` y los contratos compilan.

### E2 — Construcción en paralelo · 4 subagentes · ✅
Cada subagente trabaja en su worktree y su rama, solo en su área (§4), y respeta los contratos. El frontend trabaja contra un mock de la API generado desde los contratos hasta la integración.

#### E2.infra · ✅
> [CAMBIO E2] Código en `infra/e2` (2026-10-17). La publicación en GHCR queda para el merge a `main` (E3): el workflow solo corre ahí.
- `docker/app.Dockerfile`: multi-stage sobre `oven/bun` Debian, con libvips + libheif, exiftool y ffmpeg (el elegido en E0). Una misma imagen para app y worker.
  > [CAMBIO E0] Base `oven/bun:1.4.3-debian` (trixie). Paquetes: `libvips-tools`, `libheif-plugin-libde265`, `libimage-exiftool-perl` y `jellyfin-ffmpeg7=7.1.4-3-trixie` (repo de Jellyfin), sin el ffmpeg de Debian. Sin secretos en `ARG`/`ENV`: la imagen es pública.
- `docker/caddy.Dockerfile`: xcaddy con el módulo `caddy-dns/duckdns`.
- `docker-compose.dev.yml` para la Mac y `deploy/docker-compose.yml` de producción, que usa GHCR:
  - GPU NVIDIA opcional en el worker (si no hay, arranca igual);
  - healthchecks;
  - `restart: unless-stopped`;
  - volúmenes para el disco rápido y los grandes.
- GitHub Actions:
  - PR: lint, typecheck, `bun test`, `test:media` dentro de la imagen y e2e (`bun --bun playwright test`, sin baselines de capturas);
  - `main`: build `linux/amd64` de las dos imágenes y push a GHCR con tags `latest` y `sha-<corto>`.
- `deploy/`: `.env.example`, `deploy.sh` (pull, up, migraciones, healthcheck), `SETUP-SERVIDOR.md` y un timer de systemd opcional.

**Terminado cuando:** las imágenes están en GHCR; `deploy/docker-compose.yml` levanta localmente con un `.env` de prueba y `/api/health` responde; `test:media` corre en CI.

#### E2.ingesta · ✅
> [CAMBIO E2] Código en `ingesta/e2` (2026-10-17). 31 tests en verde, incluido el e2e por API con los fixtures.
- Módulo de almacenamiento: niveles rápido y grande, elección del disco grande con más espacio libre, rutas legibles y escritura atómica (temporal + rename).
- Asistente de primer uso (API), miembros, PIN y sesión por dispositivo (cookie de larga duración), identidad por dispositivo.
- Prechequeo de duplicados, endpoint tus, lotes, y finalización: SHA-256, deduplicación, mover al disco, crear el registro y encolar trabajos.
- Resumen del lote, con fotos sin ubicación y sugerencias.
- Endpoint del Atajo de iOS (token por miembro) y tokens administrables.

**Terminado cuando:** hay tests de deduplicación (mismo archivo dos veces = un solo registro), de subida cortada y reanudada, de elección de disco y de resumen de lote, y un e2e por API sube los fixtures y quedan encolados.

#### E2.medios · ✅
> [CAMBIO E2] Código en `medios/e2` (2026-10-17). 56 tests unitarios y 3 de `test:media` (HEIC, MOV HDR y dHash) en verde.
- Cola en `bun:sqlite`: tomar trabajos con lease, prioridades, reintentos con backoff, y liberar trabajos de un worker que murió.
- Detección de GPU al arrancar (NVENC sí/no) y concurrencia configurable (imágenes: N, videos: 1).
- Trabajos (§3.2): metadata, miniatura, versión mediana, poster, conversión de video, geocodificación, viajes, sugerencias de ubicación y hash perceptual.
- Carga de GeoNames `cities500` (descarga en el build o al primer arranque) e índice para el vecino más cercano.
- Algoritmos de la §5.
- Eventos de progreso para la web (SSE).

**Terminado cuando:** con los fixtures sintéticos, cada trabajo produce su salida y tiene su test: el HEIC genera miniatura bien orientada; el MOV HDR sale como MP4 SDR bt709 con faststart; el GPS del MOV se lee; la foto sin GPS recibe una sugerencia de otro miembro; los viajes se detectan; los duplicados parecidos se sugieren.

#### E2.frontend · ✅
> [CAMBIO E2] Código mergeado (2026-10-17). El mock queda como servidor manual; la app habla con la API real.
- Base: PWA (`vite-plugin-pwa`) con manifest y Web Share Target hacia `/compartir`, el service worker que recibe los archivos compartidos, el módulo de textos (español) y el tema cálido y accesible.
- Pantallas:
  - asistente de primer uso, con mapa para marcar la casa;
  - PIN y "¿Quién sos?";
  - subida: Uppy (arrastrar carpetas, prechequeo, Wake Lock, reanudación);
  - resumen del lote: mapa para confirmar o asignar ubicación, de a una o en lote;
  - globo (MapLibre en modo globo + OpenFreeMap) con clusters de lugares y miniaturas;
  - galería del lugar, agrupada por viaje, con grilla virtualizada;
  - visor PhotoSwipe: video, descargar original y favorito;
  - línea de tiempo, filtro por miembro, portada.
- Hito B: Chromecast (Cast Web Sender + Default Media Receiver, slideshow), administración, bandejas "Sin ubicación" y "Duplicados", guía del Atajo de iOS dentro de la app.

**Terminado cuando:** los flujos de Playwright en viewport de Android pasan contra el backend real después de la integración, y en el build de producción el Lighthouse de la PWA es instalable.
> [CAMBIO E4] Lighthouse 11.7.1 (la 13 ya no trae la categoría PWA) sobre `vite build` + `vite preview`: puntaje PWA 1, manifiesto instalable y service worker.

### E3 — Integración · coordinador · ✅
> [CAMBIO E3] Ramas mergeadas a `main` en orden. El e2e de Android pasó en local y en CI (run 39078432935, commit `54b7e7a`): asistente, subida, globo, visor y original byte a byte. Imágenes en GHCR: `ghcr.io/mateodi9z/local-family-gallery-{app,caddy}` con `latest` y `sha-54b7e7a` (`linux/amd64`). El primer e2e de CI falló porque `up --wait` exige healthcheck; quedó resuelto en ese commit.
- Mergear las ramas a `main` en orden: infra → ingesta → medios → frontend.
- Sacar el mock y apuntar el frontend a la API real.
- `docker-compose.dev.yml` completo y flujo de punta a punta: asistente → subir fixtures → aparecen en el globo → abrir el visor → descargar el original.

**Terminado cuando:** todos los e2e pasan en CI y la imagen nueva está en GHCR.

### E4 — QA · subagente qa · ✅
> [CAMBIO E4] Revisión contra SPEC y CLAUDE el 2026-10-17. `bun run check:public` y `gitleaks git --redact .` en limpio. El único faltante de producto era la documentación de la §14 (`README.md` y `GUIA-FAMILIA.md`); quedó escrita. `fixtures-reales/` no existe: la prueba con un HEIC y un MOV reales de iPhone sigue para el humano.
- Revisión punto por punto contra SPEC y CLAUDE: privacidad, cero nombres hardcodeados, originales intactos, nada se borra solo.
- Pruebas con `fixtures-reales/` si existen.
- Reporte en `ESTADO.md`. Lo que encuentre se corrige y se vuelve a pasar hasta que quede limpio.

### E5 — Despliegue en el servidor · humano + coordinador · ⬜
> [CAMBIO E5] Desde esta máquina no se puede terminar: no están el servidor, el token de DuckDNS, las rutas de los discos ni los dispositivos. Lo que sí quedó listo: `deploy/docker-compose.yml` valida con un `.env` de ejemplo, `deploy.sh` y `SETUP-SERVIDOR.md` están, y la imagen pública `sha-01e993e` respondió `/api/health` (`{"ok":true,"version":"sha-01e993e"}`). Las imágenes son públicas: en el servidor no hace falta `docker login` salvo que se pasen a privadas.
- Seguir `deploy/SETUP-SERVIDOR.md`: Docker, driver NVIDIA + Container Toolkit, discos, DuckDNS, login en GHCR.
- `deploy.sh`, asistente de primer uso con los datos reales.
- Pruebas en dispositivos reales: instalar la PWA en Android y compartir desde la galería, subir desde iPhone y desde una compu, ver un video HDR y verificar que use NVENC.

---

## 3. Contratos (se definen en E1 y se cambian solo vía coordinador)

### 3.1 Base de datos (SQLite, `bun:sqlite`, WAL)

IDs: ULID en texto. Fechas: ISO 8601 en UTC, más el offset original cuando se conoce.

```
settings        key PK, value JSON
                  claves: gallery_name, home_lat, home_lon, pin_hash, setup_done
                  [CAMBIO E1] claves reales: gallery_name, home {lat,lon}, pin_hash, setup_done,
                  cast_secret (HMAC de URLs para Chromecast), gpu {nvenc, checkedAt} (lo escribe el worker)
                  [CAMBIO E1] migración 002: batch_items(batch_id, media_id, duplicate) para el resumen del lote

members         id PK, name, color, created_at, archived_at NULL

devices         id PK, member_id FK NULL, session_hash, user_agent, created_at, last_seen_at

api_tokens      id PK, member_id FK, token_hash, label, created_at, revoked_at NULL
                  (Atajo de iOS)

volumes         id PK, tier ('fast'|'bulk'), path, enabled, created_at
                  (se sincroniza con el .env al arrancar)

batches         id PK, member_id FK, device_id FK, source ('web'|'share'|'shortcut'|'desktop'),
                created_at, finished_at NULL

media           id PK, sha256 UNIQUE, kind ('photo'|'video'), mime, size_bytes,
                original_name, volume_id FK, original_path (relativa al volumen),
                member_id FK, batch_id FK, uploaded_at,
                taken_at NULL, taken_tz NULL, taken_at_source ('exif'|'quicktime'|'file'|'upload'),
                width, height, duration_ms NULL, orientation, camera_make, camera_model,
                lat NULL, lon NULL,
                location_source NULL ('gps'|'suggested'|'manual'),
                location_confirmed (0|1), suggested_from_media_id NULL,
                place_id FK NULL, trip_id FK NULL,
                phash NULL, status ('processing'|'ready'|'error'), error NULL

derivatives     media_id FK, variant ('thumb'|'preview'|'poster'|'video'),
                volume_id FK, path, mime, width, height, bytes,
                PK(media_id, variant)

places          id PK, geoname_id UNIQUE, name, admin1, country_code, lat, lon

trips           id PK, name, name_is_custom (0|1), start_at, end_at,
                cover_media_id NULL, created_at

favorites       member_id FK, media_id FK, created_at, PK(member_id, media_id)

similar_pairs   id PK, media_a FK, media_b FK, distance,
                status ('pending'|'kept_both'|'dismissed'), created_at

jobs            id PK, type, media_id NULL, payload JSON, priority INT,
                status ('queued'|'running'|'done'|'failed'), attempts, max_attempts,
                run_after, locked_by NULL, locked_until NULL, last_error NULL,
                created_at, updated_at
                INDEX (status, priority, run_after)
```

### 3.2 Trabajos de la cola

Menor prioridad = se ejecuta antes.

| Tipo | Prioridad | Qué hace | Encola después |
|---|---|---|---|
| `extract_metadata` | 0 | exiftool → fecha, GPS, cámara, orientación, dimensiones, duración | `thumb` o `video_poster`, más `geocode` si hay GPS, o `suggest_location` si no hay |
| `thumb` | 0 | Miniatura WebP ~400 px | `preview`, `phash` |
| `video_poster` | 0 | Frame representativo → WebP. [CAMBIO E0] Genera también la variante `thumb` del video, para que la grilla no quede vacía | `video_transcode` |
| `geocode` | 1 | Lugar más cercano (cities500) → `place_id` | `assign_trips` (con debounce) |
| `suggest_location` | 1 | Busca la foto con GPS más cercana en tiempo de otro miembro (§5) | `geocode` si encuentra |
| `preview` | 2 | Versión mediana WebP ~2048 px | — |
| `phash` | 2 | dHash de 64 bits sobre la miniatura. [CAMBIO E0] Solo fotos | `find_similar` (si el hash no es casi constante) |
| `find_similar` | 3 | Compara con fotos ±10 min → `similar_pairs` | — |
| `assign_trips` | 3 | Recalcula los viajes (global, con debounce de 30 s) | — |
| `video_transcode` | 5 | MP4 H.264/AAC 1080p, faststart, tone mapping HDR, NVENC si hay | — |

### 3.3 API (`/api`, JSON validado con zod de `packages/shared`)

**Sistema y acceso**
```
GET    /health
GET    /setup/status                    → { setupDone }
POST   /setup                           { galleryName, members[], home{lat,lon}, pin }
POST   /auth/pin                        { pin } → cookie de dispositivo
GET    /me                              → { device, member|null }
POST   /me/member                       { memberId }
GET    /members   POST /members   PATCH /members/:id
GET    /settings  PATCH /settings
```

**Subida**
```
POST   /uploads/precheck                { files:[{ size, partialHash }] } → [{ exists, mediaId? }]
                                         [CAMBIO E0] partialHash = SHA-256 hex de (size uint64 BE ‖ primer MiB ‖ último MiB); ≤ 2 MiB: el archivo entero
POST   /batches                         { source } → { batchId }
*      /tus/*                           tus (metadata: filename, filetype, batchId, lastModified)
GET    /batches/:id/summary             → { total, nuevos, duplicados, places[], sinUbicacion[{ mediaId, sugerencia? }] }
POST   /shortcut/upload                 multipart, Authorization: Bearer <token>
POST   /shortcut/tokens   DELETE /shortcut/tokens/:id
```

**Ver**
```
GET    /home                            → { galleryName, hoyHaceAnios[], ultimoViaje{ trip, porMiembro[] } }
GET    /places                          → [{ id, name, lat, lon, count, coverThumbUrl }]
GET    /places/:id                      → { place, trips[{ trip, media[] }] }
GET    /trips     GET /trips/:id     PATCH /trips/:id { name }
GET    /media?placeId&tripId&memberId&favorites&cursor
GET    /media/:id
PATCH  /media/:id/location              { lat, lon }
POST   /media/location-bulk             { mediaIds[], lat, lon }
POST   /media/:id/favorite   DELETE /media/:id/favorite
```

**Bandejas y administración**
```
GET    /inbox/sin-ubicacion
GET    /inbox/similares   POST /inbox/similares/:id { action }
GET    /admin/status                    → { cola, errores[], volumenes[{ tier, path, usado, libre, alerta }] }
GET    /events                          SSE: progreso de procesamiento
```

**Archivos** (servidos con `Bun.file`, con Range y `Cache-Control: immutable`)
```
GET    /files/:sha256/:variant.:ext     variante (URL inmutable)
GET    /files/:sha256/original          descarga con Content-Disposition y el nombre original
```

### 3.4 Archivos en disco

```
<fast>/db/galeria.sqlite
<fast>/derivados/ab/cd/<sha256>_<thumb|preview|poster>.webp
<fast>/geonames/cities500.txt
<bulk N>/originales/AAAA/MM/AAAA-MM-DD_HHMMSS_<miembro>_<sha8>.<ext>
<bulk N>/videos/AAAA/MM/<sha256>_1080.mp4
<bulk N>/tmp/tus/                    temporales en el mismo disco del destino (rename sin copiar)
```

Con un solo disco, `fast` y `bulk` pueden ser el mismo path.

### 3.5 Variables de entorno (`deploy/.env.example`)

```
DATA_FAST_PATH=/data/fast
DATA_BULK_PATHS=/data/bulk1            # lista separada por comas
DOMAIN=ejemplo.duckdns.org
DUCKDNS_TOKEN=
GPU=auto                               # auto | off
WORKER_IMAGE_CONCURRENCY=4
WORKER_VIDEO_CONCURRENCY=1
DISK_ALERT_PERCENT=85
LOG_LEVEL=info
```

---

## 4. Agentes y áreas del repo

| Agente | Área (solo toca esto) | Etapa |
|---|---|---|
| coordinador (sesión principal) | raíz, `packages/shared`, migraciones, integración, `PLAN.md`, `DECISIONES.md`, `ESTADO.md` | E0, E1, E3 |
| infra | `docker/`, `deploy/`, `.github/`, `docker-compose.dev.yml` | E2 |
| ingesta | `apps/server/src/{api/rutas de setup, auth, members, settings, uploads, tus, batches, shortcut, files}`, `apps/server/src/storage/` | E2 |
| medios | `apps/server/src/{worker, media, geo}` y las rutas `/home`, `/places`, `/trips`, `/media*`, `/inbox`, `/admin/status`, `/events` | E2 |
| frontend | `apps/web/` | E2 |
| qa | solo lectura + reportes en `ESTADO.md` | E4 |

> [CAMBIO E0] Los endpoints de lectura, bandejas, admin, SSE y `/files` no tenían dueño. El esqueleto del servidor (`app.ts`, montaje de rutas) es del coordinador en E1.

**Cambiar un contrato:** el subagente lo pide, el coordinador lo cambia en `packages/shared`, avisa al resto y lo anota en `DECISIONES.md`.

---

## 5. Algoritmos

- **Geocodificación:** vecino más cercano en cities500, con índice en grilla o k-d tree. Si el más cercano está a más de 50 km, se usa la ciudad igual, pero marcada como "zona de <ciudad>".
- **Sugerencia de ubicación:** para una foto sin GPS con `taken_at`, se busca la foto con GPS de cualquier OTRO miembro con menor diferencia de tiempo, dentro de ±2 h. La confianza baja con la distancia temporal. Si no hay ninguna, va a "Sin ubicación". Nunca se marca como confirmada sola.
- **Viajes:**
  1. Ordenar por fecha las fotos con ubicación a más de 30 km de casa.
  2. Cortar el viaje cuando hay más de 36 h sin fotos lejos de casa, o cuando aparecen fotos en casa entre medio.
  3. Viajes de menos de 5 fotos se descartan.
  4. Nombre automático: el lugar con más fotos + mes y año. Si `name_is_custom`, el nombre no se pisa.
- **Duplicados:**
  - idénticos: SHA-256, se descartan en la subida;
  - parecidos: dHash de 64 bits, distancia de Hamming ≤ 6, dentro de ±10 min. Solo sugerencia. [CAMBIO E0] Se hashea siempre nuestra miniatura de 400 y se ignoran los hashes casi constantes (≤ 8 bits en 1 o en 0).
- **Fecha:** EXIF `DateTimeOriginal` con su offset, si no QuickTime `CreationDate`, si no la fecha del archivo y, como último recurso, la de subida. La fuente se guarda.
  > [CAMBIO E0] Orden exacto de tags en `DECISIONES.md`. La "fecha del archivo" es solo el `lastModified` que manda el cliente por tus (nunca la `FileModifyDate` del disco del servidor, que es la de subida). Se descartan las fechas `0000:00:00`.
- > [CAMBIO E0] **Live Photos:** hasta la Fase 2 el MOV de una Live Photo entra como un video más.

---

## 6. Lo que necesita el humano

| Qué | Cuándo |
|---|---|
| Revisar y aprobar este plan después de E0 | Antes de E1 |
| `gh` autenticado en la Mac con permiso para el repo y para Actions | E1 |
| Fotos y videos reales de prueba en `fixtures-reales/` (HEIC, MOV HDR, Android, WhatsApp, Windows) | E2 |
| Subdominio y token de DuckDNS | E5 |
| Acceso al servidor con `sudo` (driver NVIDIA, Docker, discos) | E5 |
| Token de GitHub con `read:packages` para el servidor | E5 |
| Un Android, un iPhone y el Chromecast para las pruebas finales | E5 |

---

## 7. Definición de "terminado" (para cualquier tarea)

- Tests en verde (`lint`, `typecheck`, `bun test`, y además `test:media` y `e2e` si toca esas áreas).
- Probado con archivos reales cuando involucra medios o subida.
- Sin datos personales ni nombres hardcodeados.
- `CLAUDE.md`, `DECISIONES.md` y `ESTADO.md` actualizados si corresponde.
- Commit chico, push, y la etapa marcada en este archivo.
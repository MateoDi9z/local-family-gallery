# DECISIONES.md

Formato: **fecha — decisión.** Por qué. Alternativas.

Los spikes de E0 se corrieron en `oven/bun:1.4.3-debian` (Debian 13 trixie), arm64 nativo en la Mac, con archivos **sintéticos**. Lo marcado ⚠️ **falta validar con un archivo real** de iPhone.

---

## 2026-10-17 — Repo público con guardia automática

- **Decisión:** el repo y las imágenes de GHCR quedan públicos (lo decidió el humano). La protección es automática:
  - `scripts/check-public-repo.ts` + gitleaks 8.30.1 con `.gitleaks.toml`, que extiende las reglas por defecto con el subdominio y el token de DuckDNS;
  - hooks `pre-commit` (lo staged) y `pre-push` (árbol + historial), instalados con `bun install` vía `core.hooksPath`;
  - el mismo chequeo en CI (`guardia-repo-publico`) en cada push y PR.
  - Lista privada en `.denylist.local` / secret `PRIVATE_DENYLIST`, sin imprimir nunca el término.
- **Por qué:** con un repo público, un descuido queda expuesto para siempre. El hook frena antes del commit y CI cubre el `--no-verify`.
- **Alternativas:**
  - husky / lefthook: una dependencia más para lo que hace `core.hooksPath`;
  - gitleaks-action: requiere licencia en organizaciones; el binario fijado alcanza.

## 2026-10-17 — Fixtures: manifiesto con SHA-256

- **Decisión:** todo archivo de `fixtures/` tiene que estar en `fixtures/manifest.json` con su SHA-256 y pesar ≤ 2 MB. El manifiesto lo escribe `bun run fixtures`.
- **Por qué:** con solo el nombre alcanzaría reemplazar un fixture por una foto real con el mismo nombre. El hash lo impide.
- **Alternativas:** lista de nombres (débil); prohibir medios commiteados y generarlos siempre en CI (más lento, y los tests de medios necesitan siempre los mismos bytes).

## 2026-10-17 — Íconos y capturas de e2e sin PNG en el repo

- **Decisión:**
  - Los e2e no usan baselines de `toHaveScreenshot`: se verifica con asserts funcionales, y `page.screenshot` solo como artefacto de CI con fixtures sintéticos.
  - Los íconos de la PWA son SVG o se generan en el build.
- **Por qué:** la guardia bloquea imágenes fuera de `fixtures/`. Además, las baselines dependen del SO (`-darwin` vs `-linux`) y fallan entre la Mac y CI.
- **Alternativa:** permitir `**-snapshots/*.png` en la guardia. Se descarta: abre un agujero por donde podría colarse una captura con datos reales.

## 2026-10-17 — E0 · Subidas: `@tus/server` sobre Hono + Bun

- **Decisión:** `@tus/server` 2.4.6 + `@tus/file-store` 2.1.1, montados con `app.all("/api/tus/*", c => tus.handleWeb(c.req.raw))`. Cliente: `tus-js-client` 4.3.1 (vía Uppy).
- **Evidencia:** 500 MB cortados al 47 % y al 50 %. Reanudó desde el offset del servidor y el SHA-256 coincidió. `filename`, `filetype` y `batchId` llegan en `onUploadFinish`.
- **Ajustes obligatorios:**
  - `chunkSize` del cliente: 50 MiB. Bun.serve rechaza con 413 un body de más de 128 MB (`maxRequestBodySize`).
  - `idleTimeout: 120` en Bun.serve.
  - El offset real sale del tamaño del archivo en disco, no del `.json` de FileStore.
- **Alternativa:** el subconjunto propio de tus. No hizo falta.

## 2026-10-17 — E0 · Range con `Bun.file`

- **Decisión:** `new Response(Bun.file(path))`. Bun.serve resuelve solo el 206, el sufijo y el 416.
- **Ajustes:**
  - agregar `Accept-Ranges: bytes` en el 200;
  - declarar HEAD explícito (`app.on(["GET","HEAD"])`) con el `Content-Length` real, porque Hono responde 0;
  - pisar el `Content-Disposition` que pone Bun, porque expone el nombre en disco.

## 2026-10-17 — E0 · Imágenes: CLI de vips, sin sharp

- **Decisión:** libvips 8.16.1 + libheif 1.23.4 de Debian (`libvips-tools`, `libheif-plugin-libde265`), invocados con `Bun.spawn`:
  ```
  vipsthumbnail IN --size 400x  --export-profile srgb -o OUT/thumb.webp[Q=80,keep=none]
  vipsthumbnail IN --size 2048  --export-profile srgb -o OUT/preview.webp[Q=80,keep=none]
  ```
  Rutas siempre absolutas.
- **Por qué:** sin addons nativos. El HEIC anda y la rotación `irot` se aplica sola (verificado por píxel). ~0,25 s por miniatura.
- **Trampas:**
  - Sin `keep=none`, **el GPS se copia a la miniatura**.
  - `keep=none` saca el ICC, así que va siempre con `--export-profile srgb` (si no, los Display P3 quedan desaturados).
  - En HEIC no hay que aplicar a mano el EXIF Orientation: se rotaría dos veces.
  - El generador de fixtures necesita `libheif-plugin-x265`; producción no.
- ⚠️ Falta un HEIC real: grid de tiles, 10 bits / gain map, P3.
- **Alternativa:** sharp compilado contra la libvips del sistema. Un addon nativo más, y no hace falta.

## 2026-10-17 — E0 · dHash con vips

- **Decisión:** `vips thumbnail thumb.webp .raw 9 --height 8 --size force` (un spawn, raw a stdout, ~30 ms). Bun pasa a gris (1 a 4 bandas) y calcula los 64 bits.
  - Se hashea **siempre nuestra miniatura de 400**, nunca el original.
  - No se sugieren duplicados para hashes casi constantes (≤ 8 bits en 1 o ≤ 8 en 0): cielos, paredes, fotos negras.
- **Evidencia:** misma imagen recomprimida → 0–5; imágenes distintas → ≥ 19. El umbral ≤ 6 deja margen.
- **Alternativa:** sharp. Ver arriba.

## 2026-10-17 — E0 · Metadata: exiftool persistente

- **Decisión:** un `exiftool -stay_open True -@ -` por worker, con `-n -j -fast` y tags pedidos sin grupo.
  - Arranque normal: ~50 ms (perl). Persistente: ~2 ms.
  - `-fast2` no: saltea las MakerNotes, donde está el `ContentIdentifier` de las Live Photos.
- **GPS:** `GPSLatitude` / `GPSLongitude` (Composite), que valen igual para HEIC, JPEG y MOV. En el MOV, exiftool lee `Keys:GPSCoordinates`. Descartar `0,0` y fuera de rango.
- **Fecha:**
  - fotos: `SubSecDateTimeOriginal` → `DateTimeOriginal` + `OffsetTimeOriginal` → `CreateDate` → `GPSDateTime`;
  - videos: `CreationDate` (local, con zona) → `CreateDate` (UTC) → `MediaCreateDate`;
  - si no hay ninguna, la de subida. Descartar `0000:00:00`. Nunca `FileModifyDate`.
  - Esto ajusta la §5 de PLAN, que decía "fecha del archivo".
- ⚠️ Falta un MOV real de iPhone.
- **Plan B:** ISO6709 de `ffprobe` (`com.apple.quicktime.location.ISO6709`). Probado.

## 2026-10-17 — E0 · Video: jellyfin-ffmpeg7

- **Decisión:** `jellyfin-ffmpeg7=7.1.4-3-trixie`, del repo de Jellyfin para Debian (hay paquetes amd64 y arm64). Tone mapping con `tonemapx=tonemap=bt2390:peak=100:...` y libx264 CRF 22 + faststart. El comando completo está en el spike; se fija en el código del worker. Con NVENC solo cambia el encoder a `h264_nvenc`.
- **Por qué** (contra el ffmpeg de Debian con zscale + hable):
  - satura mejor (52 contra 48 de SATAVG; sin tone mapping da 31) — verificado a ojo con los frames;
  - es ~30 % más rápido;
  - la imagen amd64 pesa ~280 MB menos;
  - trae NVENC y `tonemap_cuda`.
- **Detección de NVENC:** un encode real de 1 frame con `h264_nvenc` (listar encoders da falso positivo). En la Mac falla limpio en ~0,5 s.
- **Otras reglas:**
  - El worker solo aplica tone mapping si ffprobe da `color_transfer` `arib-std-b67` o `smpte2084`.
  - ffmpeg autorrota.
  - `-map 0:v:0 -map 0:a:0?` descarta las pistas `mebx` del iPhone.
- ⚠️ Falta un MOV HDR real (Dolby Vision 8.4) y medir el tiempo en el servidor amd64. Hay que calibrar `peak` entre 100 y 203.
- **Alternativa:** ffmpeg de Debian con zscale. Probado y funciona: es el plan B.

## 2026-10-17 — E0 · Playwright bajo el runtime de Bun

- **Decisión:** `"e2e": "bun --bun playwright test"`. CI sin `setup-node`.
- **Por qué:** pasa todo bajo Bun 1.4.3 con Playwright 1.64.1. **`bunx playwright` sin `--bun` corre con Node** sin avisar (por el shebang).
- **Alternativa:** Node solo para e2e. No hizo falta.

## 2026-10-17 — Reparto de endpoints (PLAN §4)

- **Decisión:**
  - **ingesta:** setup, auth, members, settings, uploads, tus, batches, shortcut, `/files` y el storage;
  - **medios:** lectura (`/home`, `/places`, `/trips`, `/media*`), bandejas, `/admin/status` y `/events`;
  - **coordinador:** el esqueleto del servidor (`app.ts`, montaje de rutas).
- **Por qué:** esos endpoints no tenían dueño, y cada agente sirve los datos que produce. El humano no objetó.

## 2026-10-17 — Hash parcial del prechequeo

- **Decisión:** `partialHash` = SHA-256 hex de `tamaño (uint64 big-endian) ‖ primer MiB ‖ último MiB`. Si el archivo pesa ≤ 2 MiB, se hashea completo después del tamaño. Va en `packages/shared` con un test de vectores conocidos.
- **Por qué:** el cliente y el servidor tienen que calcular exactamente lo mismo.

## 2026-10-17 — E1 · Contratos: claves en inglés

- **Decisión:** las claves JSON y las rutas siguen la convención de identificadores en inglés de `CLAUDE.md`. Por ejemplo, `newCount`, `duplicateCount` y `noLocation` en lugar de `nuevos`, `duplicados` y `sinUbicacion`, y `/inbox/no-location` y `/inbox/similar`. Fuente única: `packages/shared/src/{api,endpoints,jobs}.ts`.
- **Por qué:** el borrador del PLAN mezclaba los dos idiomas. Los textos visibles siguen en español, en el módulo de traducciones.

## 2026-10-17 — E1 · Contratos agregados al PLAN

- **Decisión:** se suman cuatro piezas que la SPEC necesita y el PLAN no tenía:
  - `POST /cast/sign`: URLs firmadas de corta duración, porque el Chromecast no tiene la cookie del dispositivo;
  - `DELETE /media/:id`: borrado explícito. El original va a una papelera (`deleted_at`) y nunca se borra nada solo;
  - `POST /admin/jobs/retry`;
  - un filtro `noLocation` en `/media`.
- **Columnas nuevas en `media`:**
  - `partial_hash`, para el prechequeo;
  - `file_modified_at`, el `lastModified` del cliente;
  - `live_photo_id`, el ContentIdentifier, que deja lista la Fase 2;
  - `hdr`, `suggestion_confidence` y `deleted_at`.
- **Simplificación:** la marca "zona de <ciudad>" (lugar a más de 50 km) queda afuera del Hito A. El lugar se asigna igual.

## 2026-10-17 — E1 · Storage y encolado son del coordinador

- **Decisión:** `apps/server/src/storage/` (volúmenes, elección de disco, rutas, escritura atómica) y `src/jobs/enqueue.ts` los escribe el coordinador en E1.
- **Por qué:** ingesta y medios dependen los dos de esas piezas. Hechas antes, pueden trabajar en paralelo sin bloquearse.
- **Cómo se nombra el original:** al subirlo, ingesta lo nombra con el `lastModified` del cliente, o con la hora de subida si no hay. Cuando `extract_metadata` conoce la fecha real, medios lo **renombra** dentro del mismo disco (rename atómico; los bytes no cambian).
- **Alternativa descartada:** correr exiftool de forma sincrónica al terminar cada subida. Acopla las dos áreas y hace más lento el final de la subida.

## 2026-10-17 — E3 · `up --wait` y el worker de e2e

- **Decisión:** en `docker-compose.e2e.yml` el worker tiene un healthcheck que solo comprueba que el proceso 1 siga vivo (`bun -e process.kill(1,0)`).
- **Por qué:** en el Compose del runner de GitHub, `docker compose up --wait` sale con error si algún servicio no tiene healthcheck (`container has no healthcheck configured`). En local, con un Compose más viejo, el mismo comando pasaba. El worker no abre un puerto.
- **Alternativa:** esperar solo el healthcheck de la app en el workflow. Se descarta: el comentario del compose y CI dicen `up --wait`, y el fallo volvería en cualquier otro servicio sin chequeo.

## 2026-10-17 — E1 · Tests de medios y e2e

- **Tests de medios:** los que necesitan vips, exiftool o ffmpeg usan `mediaTest` (`apps/server/src/test-utils.ts`). Corren solo con `MEDIA_TESTS=1`, dentro de la imagen `dev` (`bun run test:media`), con `node_modules` en un volumen de Docker aparte.
- **e2e:** los archivos se llaman `*.e2e.ts` para que `bun test` no los levante.
- **HTTPS en desarrollo:** no se usa. `localhost` ya es un contexto seguro para la PWA y el service worker.
- **Fixtures:** `bun run fixtures` genera 7 archivos dentro de la imagen `dev` (jellyfin-ffmpeg trae zscale y libx265).
- **`bun install` dentro del contenedor** va con `--ignore-scripts`. El `prepare` configura los hooks de git, y en un worktree `.git` apunta afuera de la carpeta montada.

## 2026-10-18 — Globo en blanco: worker de MapLibre

- **Problema:** el globo se veía blanco, sin países ni marcadores. MapLibre 6 arma la URL de su worker en runtime (`new URL("./maplibre-gl-worker.mjs", import.meta.url)`), Vite no la detecta y no empaqueta el archivo. El servidor devolvía el `index.html` en su lugar y el worker no arrancaba: solo se veía el fondo del mapa. El e2e pasaba igual porque entraba al lugar por la tira de abajo, no por el mapa.
- **Decisión:** `setWorkerUrl()` con el worker importado con `?url` (`apps/web/src/components/map.ts`). El e2e ahora espera un marcador del globo, que solo aparece si el worker procesa los datos.
- **De paso:** fondo de espacio y atmósfera alrededor del globo, nombres del mapa en español (`name:es`, si no el del estilo) y zoom inicial calculado para que entre el planeta entero (MapLibre agranda el globo por 1/cos(latitud) del centro). El mapa nace plano y con zoom bajo recorta la latitud del centro, así que se vuelve a centrar después de pasar a globo.
- **Alternativa descartada:** copiar el worker a `public/` con un plugin. Es más código, y además hay que mantener la versión a mano.

## 2026-10-18 — Instalar sin acceso al router

- **Problema:** `INSTALAR.md` pedía entrar al router para fijarle la IP a la PC (reserva DHCP) y, si hacía falta, para la excepción de DNS rebinding. No siempre se tiene acceso al router.
- **Decisión:** `deploy/duckdns-ip.sh` le avisa a DuckDNS la IP local actual de la PC (la de la ruta por defecto, no las de Docker), y `galeria-ip.timer` lo repite cada 5 minutos y al arrancar. Si el router le cambia la IP, el dominio la sigue en minutos (el TTL de DuckDNS es corto). Además, ya no hay que cargar la IP a mano en DuckDNS. El token va a curl por stdin, para que no aparezca en `ps`. Para el DNS rebinding sin router: DNS de Cloudflare en cada dispositivo (DNS privado en Android, DNS manual en iPhone, DNS seguro en Chrome).
- **Por qué:** no toca el router y es un script de 20 líneas sobre lo que ya está en la PC (`ip`, `curl`), con el mismo patrón de systemd que `galeria-update`. SPEC §4 se sigue cumpliendo: el dominio apunta a la IP local.
- **Alternativas descartadas:** IP fija configurada en la PC (sin ver el rango DHCP del router puede chocar con otro dispositivo); `.local` por mDNS (Let's Encrypt no da certificados para `.local`, y sin HTTPS no hay PWA ni Cast); un contenedor de DuckDNS en el compose (necesitaría `network_mode: host` para ver la IP de la PC y es una imagen más).

## 2026-10-18 — Página «Estado del sistema»

- **Decisión:** pantalla `/estado`, en Más. Desde el navegador revisa la red del dispositivo (`navigator.onLine` y, en Chrome de Android, `connection.type` para avisar si está con datos), internet (pide el estilo de OpenFreeMap, la única excepción de internet), HTTPS (`isSecureContext`) y `/api/health` con su latencia. Del servidor usa `/admin/status`: base de datos (si responde, la base anda), worker, cola, errores y discos. Se revisa sola cada 15 s.
- **Worker vivo:** el worker no abre puertos, así que anota `worker_seen_at` en `settings` en cada mantenimiento (30 s). `/admin/status` suma `worker: { alive, seenAt }` (contrato en `packages/shared`, cambio del coordinador); `alive` es un latido de menos de 90 s, con el reloj del servidor.
- **Servidor caído:** la pantalla de «No podemos conectar» ahora es esta misma página, sin lo que pide PIN. Reintenta sola cada 15 s y entra a la app cuando el servidor vuelve. Si no, la página de estado no se podría abrir justo cuando hace falta.
- **Administración:** la cola y los discos se mudaron a esta página (SPEC §11 los pide en la parte de administración; siguen ahí, en otra pantalla de Más).
- **Afuera, a propósito:** vencimiento del certificado (Caddy es otro contenedor), conexión de los eventos en vivo (SSE) e internet visto desde el servidor.

## 2026-10-18 — Borrar desde el visor

- **Decisión:** tachito en la barra del visor, con un diálogo de confirmación. Usa `DELETE /media/:id`, que ya movía el original a `papelera/`. Puede borrar cualquier miembro: no hay permisos por persona.
- **Después de borrar:** el visor se cierra y la pantalla recarga. Sacar la foto de PhotoSwipe sin cerrarlo es más código para casi nada.
- **Alternativa descartada:** `window.confirm()`. Es menos código, pero no muestra la foto y queda fuera del estilo de la app.

## 2026-10-18 — Fotos corridas en Android: el filtro de personas

- **Problema:** en Android las fotos del visor se veían corridas hacia abajo y cortadas, y la barra de botones quedaba afuera. La fila de personas es un `<fieldset>`, que por defecto no se achica por debajo de su contenido (`min-inline-size: min-content`): con 3 o más personas ensanchaba toda la página. Chrome de Android agrandaba el viewport (710 × 1314 en un celu de 393 × 851) y PhotoSwipe centraba la foto en ese tamaño.
- **Decisión:** `.chips` con `min-inline-size: 0` y `flex-wrap: wrap`: las personas pasan a otra línea, todas a la vista. La barra del visor queda en una fila (ícono y texto corto) y PhotoSwipe reserva el lugar de las dos barras (`paddingFn`), así ninguna tapa la foto.
- **Alternativa descartada:** `overflow-x: hidden` en `body`. Tapa el síntoma, y cualquier otro desborde volvería a romper el visor sin que se note.

## 2026-10-18 — Guía de la tele con chequeo en vivo

- **Decisión:** pantalla `/tele` con los pasos y un chequeo: iPhone (no se puede), navegador sin Chrome, SDK de Cast cargando, sin teles en el wifi (`CAST_STATE_CHANGED` del SDK) o listo. El botón «Buscar la tele» abre la lista de Chrome sin mandar nada, para probar.

## 2026-10-18 — Borrar un lugar entero

- **Decisión:** `POST /places/:id/delete-all` con `{ confirmName }`. El nombre se compara en la pantalla y también en el servidor, con la misma regla (`sameName` en `packages/shared`: sin importar mayúsculas, tildes ni espacios de más). Cada foto pasa por el mismo borrado que una sola (`deleteMedia`): el original va a `papelera/`.
- **Por qué POST y no DELETE:** lleva un body, y un DELETE con body no siempre pasa por proxies y clientes.
- **Si falla a la mitad:** las fotos ya borradas quedan borradas (cada una es atómica) y la respuesta es un error; se puede volver a intentar.

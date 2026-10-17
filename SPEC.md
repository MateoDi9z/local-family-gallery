# Galería Familiar Local — Especificación

Una web de fotos y videos de viajes para una familia o grupo. Corre en un servidor dentro de la casa, todos suben sus fotos fácilmente desde cualquier dispositivo, y se ven en un globo terráqueo desde el celular o en la tele con Chromecast.

---

## 1. Visión

- **El problema:** después de cada viaje, las fotos quedan repartidas en los celulares de cada uno. Nadie se acuerda de pasarlas, son muchas, pesan mucho y por mensajería pierden calidad.
- **La solución:** un lugar único y privado, dentro de casa, donde todos tiran sus fotos y videos originales, y cualquiera los ve organizados por lugar y por viaje.
- **Lo más importante: subir fotos tiene que ser facilísimo**, tan fácil como mandarlas por un chat. Si cuesta, nadie lo va a usar.
- **Usuarios:** familias con dispositivos mezclados (Android, iPhone, Mac, Windows). Hay que asumir que algunos miembros no son técnicos (por ejemplo, personas mayores): la experiencia tiene que ser simple, con letra y botones grandes.
- **Genérico:** nada de nombres, ciudades ni datos personales en el código. Todo lo personal se configura desde la app.

## 2. Configuración inicial (asistente de primer uso)

La primera vez que se abre la app, un asistente simple pide:

1. Nombre de la galería, que se ve en la portada (por defecto: "Galería Familiar Local").
2. Miembros: nombre y color de cada uno. Se pueden agregar o editar después.
3. Ubicación de casa, marcándola en el mapa. Sirve para distinguir fotos de viaje de fotos locales.
4. PIN familiar.

Todo se guarda en la base y se puede cambiar desde la página de administración.

## 3. Entornos

- **Desarrollo:** en cualquier máquina con Docker, incluidas Mac con Apple Silicon. Sin GPU NVIDIA, ffmpeg usa CPU.
- **Producción:** servidor Linux en la red de casa (referencia: Debian), con Docker.
  - GPU NVIDIA opcional: si existe, se usa NVENC/NVDEC; si no, CPU automáticamente.
  - Uno o más discos, configurables (ver §7).
- **Acceso SOLO desde la red local.** No se expone nada a internet.

El código vive en GitHub. GitHub Actions construye las imágenes Docker y las publica en GHCR. El servidor hace pull y corre.

## 4. Arquitectura

- **Runtime: Bun**, en todo el proyecto: runtime, gestor de paquetes, workspaces, test runner y scripts.
- **Monorepo con workspaces de Bun:**
  - `apps/server`: API + worker, mismo código, distinto comando;
  - `apps/web`: frontend;
  - `packages/shared`: tipos y contratos compartidos.
- **Docker Compose** con tres servicios, todos con `restart: unless-stopped`:
  - `caddy`: reverse proxy y HTTPS (build propio con el módulo DNS de DuckDNS);
  - `app`: API Hono sobre Bun + frontend estático;
  - `worker`: procesamiento en segundo plano, con acceso a la GPU si existe.
- **HTTPS dentro de la red local**, necesario para la PWA, el Web Share Target y Cast: un dominio (por defecto un subdominio gratuito de DuckDNS, configurable) apunta a la IP local del servidor, y el certificado se saca con Let's Encrypt por desafío DNS-01. No hay que instalar nada en los celulares. Documentar qué hacer si el router bloquea DNS que resuelven a IPs privadas (DNS rebinding).
- **Backend:** Bun + TypeScript con Hono. Aprovechar las APIs nativas de Bun: `Bun.serve`, `Bun.file` (archivos con soporte de Range), `Bun.spawn` (herramientas externas) y `Bun.password` (hash del PIN).
- **Base:** SQLite con `bun:sqlite` (nativo de Bun) en modo WAL, en el disco rápido.
- **Cola de trabajos:** tabla en SQLite (sin Redis), con prioridades, reintentos y que sobreviva reinicios. El worker es un proceso separado para que procesar nunca haga lenta la web.
- **Subidas:** protocolo tus + Uppy en el cliente. Verificar que `@tus/server` funcione bien sobre Bun y Hono (handler basado en Request/Response). Si no, implementar el subconjunto del protocolo tus que se necesita.
- **Frontend:** React + Vite + TypeScript corriendo con Bun, PWA (`vite-plugin-pwa`), visor PhotoSwipe, mapa MapLibre GL en proyección globo con mapas de OpenFreeMap (online, sin cuenta). El globo tiene que ser cómodo y fluido; no hace falta mucho detalle.
- **Imagen Docker:** basada en `oven/bun` sobre Debian, para instalar las herramientas con apt.
- **Herramientas en la imagen, invocadas con `Bun.spawn`:**
  - exiftool para la metadata;
  - libvips del sistema con soporte HEIC (el sharp prearmado NO lee HEIC; preferir la CLI de libvips o sharp compilado contra el libvips del sistema, si funciona bajo Bun);
  - ffmpeg con NVENC/NVDEC, tone mapping HDR y fallback automático a CPU. Evaluar jellyfin-ffmpeg, que trae NVENC y filtros de tone mapping ya incluidos.
- **Evitar addons nativos de Node que no estén verificados en Bun.**
- **Nombres de lugares:** GeoNames `cities500` local, búsqueda por vecino más cercano. Offline.

## 5. Repo, CI/CD y despliegue

- **Ramas:** `main` siempre desplegable; trabajo en ramas por área, con merge cuando los tests pasan.
- **GitHub Actions** (con `oven-sh/setup-bun`):
  - en cada PR: lint, typecheck, tests unitarios y de medios (dentro de la imagen Docker, para que el entorno sea idéntico a producción) y Playwright;
  - en `main`: build de las imágenes `linux/amd64` (app/worker y caddy) y push a GHCR con tags `latest` y `sha`.
- **Carpeta `deploy/`:**
  - `docker-compose.yml` de producción, que usa las imágenes de GHCR;
  - `.env.example`;
  - `deploy.sh`: pull + up + migraciones;
  - `SETUP-SERVIDOR.md`: instalación en Linux (Debian/Ubuntu) de Docker, driver NVIDIA y NVIDIA Container Toolkit (opcional), login en GHCR con token `read:packages`, montaje de discos y configuración del dominio;
  - opcional: timer de systemd que revisa si hay imagen nueva y despliega solo.
- **Desarrollo local:** `docker compose` de desarrollo con recarga en caliente, o ejecución nativa. Lo que funcione mejor; documentarlo.

## 6. Privacidad y secretos

- NUNCA commitear fotos reales, datos personales, tokens ni PINs. Todo va en `.env`, que está en `.gitignore`.
- Ningún nombre de persona ni de lugar hardcodeado en el código, los tests o la documentación. Usar ejemplos genéricos ("Persona 1", "Ciudad de ejemplo").
- Fixtures: en CI se usan archivos **sintéticos** generados por script (JPEG con GPS inyectado, HEIC, video HEVC HDR, fotos sin GPS). Las fotos reales de prueba viven en `fixtures-reales/` (gitignored) y solo se usan localmente.

## 7. Almacenamiento

- **Dos niveles:**
  - "rápido" (idealmente SSD): base, miniaturas y versiones medianas de fotos;
  - "grande" (puede ser HDD): originales y videos convertidos.
- **El nivel grande es una LISTA de discos configurable.** Agregar un disco = sumarlo a la configuración. Lo nuevo se guarda en el disco con más espacio libre, la base anota en qué disco está cada archivo, y hay un comando para mover archivos entre discos.
- **Con un solo disco**, los dos niveles pueden apuntar al mismo lugar.
- **Originales SIEMPRE intactos**, en carpetas por fecha con nombres legibles: `AAAA/MM/AAAA-MM-DD_HHMMSS_<miembro>_<hash corto>.<ext>`.
- **La organización vive en la base**, no en las carpetas: viajes, lugares y favoritos. Si la app desaparece, las fotos siguen siendo entendibles.

## 8. Subida (prioridad máxima en experiencia)

Tiene que ser tan fácil como mandar algo por un chat.

- **Android:** la PWA instalada se registra como destino de "Compartir" (Web Share Target). Se eligen fotos en la galería → Compartir → la app → listo.
- **iPhone:** iOS no soporta Web Share Target. Endpoint con token para un Atajo de iOS ("Enviar a la galería") que aparece en el menú Compartir de Fotos, con instrucciones paso a paso para crearlo, accesibles desde la app. Verificar que lleguen originales con GPS; si iOS convierte o quita metadata, documentar cómo evitarlo.
- **Desde cualquier celular:** botón para elegir fotos de la galería en la web.
- **Desde Mac y Windows:** arrastrar carpetas enteras desde cualquier navegador (Chrome, Safari, Edge, Firefox), sin instalar nada. En Mac, mostrar cómo exportar desde la app Fotos con "Exportar original sin modificar".

Reglas para todas las vías:

- Se pregunta qué miembro sos una vez por dispositivo y se recuerda.
- Antes de subir, chequeo rápido (tamaño + hash parcial calculado en el cliente) contra el servidor para no volver a subir lo que ya existe. El servidor confirma con SHA-256 completo.
- Subidas reanudables, en paralelo, con progreso claro y la pantalla encendida mientras sube (Wake Lock).
- Formatos: HEIC, JPG, PNG, MOV y MP4, incluidas fotos de iPhone pasadas por cable a Windows (ya convertidas a JPG o en HEIC).
- Al terminar, un resumen: "Subiste 143 fotos de <lugar>. 12 no tienen ubicación: ¿son de acá?", con lugar sugerido y un mapa para confirmar o corregir. Se puede asignar un lugar a todo un lote o carpeta de una vez.

## 9. Procesamiento

- **Prioridades de la cola:**
  1. metadata + miniatura: la foto tiene que aparecer en el mapa en segundos;
  2. versiones medianas;
  3. conversión de videos.
- **Metadata de fotos Y videos:** fecha, GPS (en los .MOV de iPhone está en metadata QuickTime), dispositivo, orientación.
- **Fotos:** miniatura (~400 px) y versión mediana (~2048 px) en WebP o JPEG, respetando la orientación.
- **Videos:** poster + MP4 H.264/AAC a 1080p con faststart, usando NVENC si hay GPU. Los videos de iPhone suelen ser HDR: aplicar tone mapping HDR→SDR para que no queden lavados. Servidos con soporte de Range.
- **Ubicación sugerida para fotos sin GPS:** cruzar con fotos de OTROS miembros tomadas en horario cercano (en los viajes en grupo casi siempre acierta). Queda como "sugerida" hasta que alguien la confirma. Las que no tienen sugerencia van a la bandeja "Sin ubicación".
- **Viajes:** detectados automáticamente por fecha y distancia a casa, con nombre editable ("<Lugar>, <mes> <año>").
- **Duplicados:**
  - los idénticos no se guardan dos veces;
  - los parecidos (hash perceptual: misma escena sacada por varios, ráfagas) SOLO se sugieren para revisar;
  - nunca se borra nada automáticamente.

## 10. Ver las fotos

- **Pantalla principal:** globo con clusters que se agrupan o separan con el zoom, con una miniatura por lugar. Tocás un lugar → galería de ese lugar, organizada por viaje.
- **Portada:**
  - el nombre de la galería;
  - "Hoy hace X años…";
  - el último viaje con cuántas fotos subió cada miembro.
- **Vistas y filtros:** línea de tiempo de viajes como vista alternativa, y filtro por miembro.
- **Rendimiento:** grilla virtualizada, imágenes responsive, URLs inmutables con caché larga, y service worker que cachea miniaturas. Tiene que andar fluido en un Android de gama media.
- **Visor:** pantalla completa con swipe, video, "Descargar original" y favoritos.
- **Chromecast:** botón de Cast (Google Cast Web Sender + Default Media Receiver). La tele solo muestra; el celu es el control remoto: elegir foto o video, pasar, pausar, y slideshow de un viaje o lugar.
- **Diseño:** mobile-first, cálido y lindo, accesible para personas no técnicas: letra y botones grandes, cero complicaciones. Interfaz en español, con los textos centralizados para poder traducirla después.
- **Acceso:** PIN familiar, pedido una sola vez por dispositivo.

## 11. Administración

- Miembros, nombre de la galería, ubicación de casa y PIN.
- Estado de la cola y errores de procesamiento.
- Uso de cada disco, con alerta cuando alguno pase el 85 %.

## 12. Prioridades (en este orden)

1. Monorepo + CI/CD a GHCR + `deploy/` listo para el servidor.
2. Asistente de primer uso + subida desde compu (arrastrar carpetas) y desde la web del celu, con chequeo de duplicados y reanudación.
3. Procesamiento: metadata, miniaturas, versiones medianas, videos.
4. Globo + galería + visor + descargar original.
5. PWA instalable + Compartir desde Android.
6. Atajo de iOS.
7. Chromecast.
8. Portada, sugerencias de ubicación, viajes automáticos, favoritos, duplicados parecidos, administración.

## 13. Fase 2 (no ahora, pero con la arquitectura lista)

- Subida automática desde los celulares (por ejemplo PhotoSync al estar en el wifi de casa), con una bandeja donde cada uno aprueba qué se publica.
- Backup automático a otro disco.
- Ruta del viaje animada sobre el globo.
- Live Photos (par HEIC+MOV) que se muevan al tocarlas.
- Más idiomas.

## 14. Calidad

- **Tests:**
  - `bun test` para metadata, conversiones, duplicados, detección de viajes y sugerencias de ubicación;
  - Playwright en viewport de Android (si su runner da problemas bajo Bun, se usa Node solo para los e2e) para el asistente de primer uso, subir, ver en el mapa, abrir el visor y descargar.
- **Nada se da por terminado sin probarlo con archivos reales.**
- **Decisiones técnicas** anotadas en `DECISIONES.md`, con su motivo.
- **Documentación final:**
  - `README.md` técnico en español: desarrollo, instalación, despliegue, agregar discos, respaldo, problemas comunes;
  - `GUIA-FAMILIA.md`: una página sin tecnicismos sobre cómo instalar la app, subir desde Android, iPhone, Mac y Windows, y usar el Chromecast.
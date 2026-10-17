# CLAUDE.md — Galería Familiar Local

Galería privada de fotos y videos de viajes para una familia. Corre en un servidor dentro de la casa, todos suben desde cualquier dispositivo y se ve en un globo terráqueo desde el celular o en la tele con Chromecast.

**`SPEC.md` es la fuente de verdad del producto.** Si algo de este archivo la contradice, gana `SPEC.md`, y hay que avisarlo.

## Documentos del repo

| Archivo | Para qué |
|---|---|
| `SPEC.md` | Qué hay que construir. No se modifica sin acuerdo del humano. |
| `PLAN.md` | Etapas, contratos, reparto entre agentes. |
| `DECISIONES.md` | Cada decisión técnica con su motivo (formato: fecha, decisión, por qué, alternativas). |
| `ESTADO.md` | Qué está hecho, qué falta, qué tiene que revisar el humano. |
| `GUIA-FAMILIA.md` | Guía de uso sin tecnicismos. |
| `deploy/SETUP-SERVIDOR.md` | Cómo instalar y desplegar en el servidor. |

## Reglas que no se rompen nunca

1. **Privacidad:** nunca commitear fotos reales, datos personales, tokens, PINs ni `.env`. Las fotos reales de prueba van en `fixtures-reales/` (gitignored).
2. **Producto genérico:** cero nombres de personas, ciudades o lugares hardcodeados en código, tests, seeds o docs. En ejemplos usar "Persona 1", "Ciudad de ejemplo".
3. **Originales intactos:** el archivo subido se guarda byte a byte. Nunca se modifica, recomprime ni se le borra metadata.
4. **Nunca borrar automáticamente:** duplicados parecidos y similares solo se sugieren. Borrar requiere acción explícita de un usuario.
5. **Subir tiene que ser fácil:** ante cualquier duda de diseño, gana la opción que le pida menos pasos al usuario.
6. **Solo red local:** nada se expone a internet ni depende de servicios pagos. Única excepción: los mapas de OpenFreeMap.

## Estructura

```
apps/server/        API (Hono sobre Bun) + worker (mismo código, distinto comando)
apps/web/           Frontend React + Vite (PWA)
packages/shared/    Contratos: tipos, esquemas zod, endpoints, tipos de trabajos de la cola
deploy/             Compose de producción, .env.example, deploy.sh, SETUP-SERVIDOR.md
docker/             Dockerfiles (app/worker y caddy)
scripts/            Utilidades (generar fixtures, mover archivos entre discos, etc.)
fixtures/           Medios sintéticos generados por script (se pueden commitear si son chicos)
fixtures-reales/    Fotos reales de prueba — GITIGNORED
.claude/agents/     Subagentes del proyecto
.claude/skills/     Skills del proyecto
```

## Comandos

Scripts de la raíz que tienen que existir y funcionar. Si cambian, se actualiza esta tabla.

| Comando | Qué hace |
|---|---|
| `bun install` | Instala todo (workspaces de Bun) |
| `bun run dev` | Levanta el entorno de desarrollo (web + api + worker) |
| `bun run lint` | Lint y formato de todo el monorepo (Biome) |
| `bun run typecheck` | TypeScript en modo estricto (`tsc --noEmit`) |
| `bun test` | Tests unitarios (test runner de Bun) |
| `bun run test:media` | Tests del pipeline de medios **dentro de la imagen Docker** |
| `bun run e2e` | Playwright en viewport de Android |
| `bun run fixtures` | Genera los medios sintéticos de prueba |
| `bun run db:migrate` | Aplica migraciones |

**Antes de cada commit:** `bun run lint && bun run typecheck && bun test`.
**Antes de mergear a `main`:** además `bun run test:media` y `bun run e2e`.

## Bun

- **Bun es el runtime, el gestor de paquetes y el test runner.** No usar npm, pnpm ni yarn. El lockfile es `bun.lock` y se commitea.
- **Preferir las APIs nativas de Bun** antes que paquetes de npm:
  - `bun:sqlite` para la base;
  - `Bun.serve` + Hono para el servidor;
  - `Bun.file` para servir archivos (con Range);
  - `Bun.spawn` para exiftool, libvips y ffmpeg;
  - `Bun.password` para el PIN;
  - `Bun.CryptoHasher` para los hashes.
- **Addons nativos de Node:** antes de sumar uno, verificar que funcione en Bun dentro de la imagen Docker. Si no, buscar alternativa o invocar la herramienta por CLI.
- **Imagen Docker** basada en `oven/bun` sobre Debian.
- **CI** con `oven-sh/setup-bun`.
- **Playwright:** si su runner da problemas bajo Bun, se usa Node solo para los e2e. Anotarlo en `DECISIONES.md`.

## Convenciones de código

- TypeScript estricto, ESM. Nada de `any` sin justificar en un comentario.
- **Idioma:** identificadores y nombres de archivos en inglés; textos de UI, comentarios, docs y mensajes de commit en español.
- **Textos de UI centralizados** en un único módulo de traducciones (español por defecto). Nunca strings sueltos en componentes.
- **Contratos en `packages/shared`:** todo lo que cruza entre web, API y worker (requests, responses, trabajos de la cola) se define ahí con zod y se valida en ambos extremos.
- **Base de datos:** SQLite en modo WAL. Migraciones numeradas; una migración ya aplicada nunca se edita, se crea otra.
- **Configuración** solo por variables de entorno, documentadas en `deploy/.env.example`.
- **Logs** estructurados, sin datos personales ni rutas completas de fotos en nivel info.

## Pipeline de medios: trampas conocidas

- **HEIC:** el sharp prearmado NO lo lee. Se usa libvips del sistema con libheif. Probar siempre con un `.heic` real.
- **GPS en videos:** en los `.MOV` de iPhone está en metadata QuickTime, no en EXIF. Usar exiftool.
- **HDR:** los videos de iPhone suelen ser HDR (HLG / Dolby Vision). Sin tone mapping a SDR quedan lavados. Verificar visualmente el resultado.
- **GPU:** detectar NVENC al arrancar el worker y caer a libx264 si no está. En la Mac de desarrollo nunca hay GPU NVIDIA: el camino CPU tiene que funcionar siempre.
- **Orientación:** aplicar la rotación EXIF al generar derivados.
- **Hash del cliente:** es solo un chequeo rápido. La verdad es el SHA-256 calculado en el servidor.
- **iOS al subir:** Safari o Atajos pueden convertir a JPEG o quitar el GPS. Cualquier cambio en la subida desde iPhone se prueba con un archivo real.

## Entornos

- **Desarrollo:** Mac (posiblemente Apple Silicon), sin GPU NVIDIA, HTTPS en `localhost`.
- **Producción:** servidor Linux `linux/amd64` con Docker, GPU NVIDIA opcional, HTTPS por Caddy + DuckDNS.
- **Las imágenes de producción solo se construyen en GitHub Actions** y se publican en GHCR. No se publican imágenes desde la Mac.
- **Lo que depende del entorno** (libvips, ffmpeg, exiftool) se testea dentro del contenedor, no con lo instalado en la Mac.

## Git

- `main` siempre desplegable: CI en verde, nunca `push --force`.
- Una rama por área o tarea: `infra/…`, `ingesta/…`, `medios/…`, `frontend/…`.
- Commits chicos con Conventional Commits en español, por ejemplo: `feat(ingesta): reanudar subidas cortadas`.
- Push frecuente: el humano sigue el progreso desde GitHub.

## Trabajo con varios agentes

- Cada subagente trabaja en su propio worktree y rama, y solo toca su área.
- **Cambiar un contrato de `packages/shared`** lo decide el agente coordinador, nunca un subagente por su cuenta. Se pide, se acuerda y se anota en `DECISIONES.md`.
- El agente `qa` no escribe código de producto: verifica contra `SPEC.md` y reporta.
- Al terminar una tarea: tests en verde, commit, push, y una línea en `ESTADO.md`.

## UX

- **Mobile-first**, pensado para personas no técnicas: letra grande, botones grandes, pocos pasos, todo en español.
- **Tiene que andar fluido en un Android de gama media:** grillas virtualizadas, imágenes del tamaño justo, caché agresiva.
- **Cálido y lindo, no corporativo:** es una galería familiar.
- **Mensajes de error** en lenguaje humano, que digan qué hacer ("Se cortó el wifi, la subida va a seguir sola").

## Cuándo frenar y preguntar

Solo en estos casos:

- se necesitan secretos o cuentas (tokens, DuckDNS, GHCR);
- hay una acción irreversible o que necesita `sudo`;
- algo contradice `SPEC.md`.

Todo lo demás: decidir, anotar en `DECISIONES.md` y seguir.

## Mantener este archivo

Si cambian los comandos, la estructura o aparece una trampa nueva, se actualiza este archivo en el mismo commit.
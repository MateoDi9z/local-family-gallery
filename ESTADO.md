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
- 2026-10-17 · E4: QA contra SPEC y CLAUDE. Guardia y gitleaks en limpio. Lighthouse 11.7.1, PWA 1 (instalable) sobre el build de producción. Se agregaron `README.md` y `GUIA-FAMILIA.md` (SPEC §14).
- 2026-10-17 · E3 cerrada: CI en verde (checks, `test:media` y e2e) en el run 39078432935, commit `54b7e7a`. Imágenes publicadas: `ghcr.io/mateodi9z/local-family-gallery-app` y `…-caddy`, tags `latest` y `sha-54b7e7a`, `linux/amd64`. La imagen `sha-01e993e` arrancó y `/api/health` respondió `{"ok":true}`.
- 2026-10-18 · El globo se veía blanco: el worker de MapLibre no se empaquetaba. Quedó arreglado, con un chequeo nuevo en el e2e. También se pulió la UI: espacio y atmósfera alrededor del globo, nombres del mapa en español, el planeta entero a la vista al abrir, créditos que no tapan la tira de lugares, visor con fondo opaco, «Volver» alineado, fotos sin ubicación en grilla y un texto de portada que no dice «no hay fotos» cuando sí hay.
- 2026-10-18 · Instalación sin acceso al router: `deploy/duckdns-ip.sh` + `galeria-ip.timer` le avisan a DuckDNS la IP local de la PC cada 5 minutos (reemplaza la reserva DHCP y la carga a mano). Para el DNS rebinding sin router, DNS por dispositivo. `INSTALAR.md` y `SETUP-SERVIDOR.md` actualizados.
- 2026-10-18 · Página **Estado del sistema** (`/estado`, desde Más): red del dispositivo, internet, HTTPS, API, base, worker (latido nuevo), cola, errores y discos. También es la pantalla cuando el servidor no responde. La cola y los discos salieron de Administración.
- 2026-10-18 · Botón «Borrar» (tachito) en el visor, con confirmación. Usa el `DELETE /media/:id` que ya existía (el original va a `papelera/`). La barra del visor pasa a dos filas en celus angostos.
- 2026-10-18 · Android: las fotos del visor se veían corridas hacia abajo y cortadas. Era la fila de personas (un `<fieldset>` que no se achica) ensanchando la página; ahora pasa a otra línea. La barra del visor va en una fila (ícono + texto) y la foto queda entre las barras.
- 2026-10-18 · Página **Ver en la tele** (`/tele`, desde Más): guía de Chromecast con un chequeo en vivo (iPhone, navegador, si hay una tele en el wifi) y un botón para buscar la tele.
- 2026-10-18 · **Borrar todas las fotos de un lugar**, al final del lugar: pide escribir el nombre (sin importar mayúsculas ni tildes) y el servidor lo vuelve a revisar. Los originales van a la papelera.

## Falta

- E5, en el servidor de la casa. Desde esta máquina no está ese servidor, ni el token de DuckDNS, ni las rutas de los discos, ni un Android, un iPhone o la tele. El resto del plan (E0 a E4) está cerrado. Fase 2 (SPEC §13) queda para más adelante, a propósito.

## QA (E4)

Revisión del 2026-10-17 sobre `main`. Comandos: `bun run check:public` (160 archivos, en orden) y `gitleaks git --redact .` (26 commits, sin secretos).

| Qué dice la SPEC | Dónde | Resultado |
|---|---|---|
| Nada de fotos reales, tokens ni PIN en el repo (§6) | guardia + gitleaks | Limpio |
| Sin nombres de personas ni de lugares en código, tests o docs (§6) | ejemplos «Persona 1» y «Ciudad de ejemplo»; el GPS de los fixtures es de monumentos públicos, como pide CLAUDE.md | Limpio |
| Originales intactos; nada se borra solo (§7, §9) | `DELETE /media/:id` mueve el original a `papelera/` solo si un usuario lo pide (`apps/server/src/views/index.ts`) | Limpio |
| Documentación final (§14) | faltaban `README.md` y `GUIA-FAMILIA.md` | Corregido en este cambio |
| PWA instalable (§10, §12.5) | Lighthouse 11.7.1 contra `http://127.0.0.1:4173` (build de `vite build`) | Puntaje PWA 1: manifiesto instalable, ícono maskable, splash y viewport |
| Probar con archivos reales (§14) | `fixtures-reales/` no está | Queda para el humano |

No se encontró nada sensible ya subido.

## Cómo retomar

- `PLAN.md` marca las etapas. E0 a E4 están cerradas. Sigue E5, en el servidor. Los worktrees de E2 siguen en `../lfg-wt/`; el código integrado está en `main`.

## Para revisar el humano

- Validar con archivos reales de iPhone en `fixtures-reales/`: un `.heic` y un `.MOV` HDR con ubicación. Los spikes y el e2e se hicieron con sintéticos. SPEC §14 pide esa prueba antes de dar el producto por cerrado del todo.
- Opcional: cargar los términos privados en `.denylist.local` (Mac) y en el secret `PRIVATE_DENYLIST` (GitHub), uno por línea: el dominio de DuckDNS, la IP pública y los nombres reales.
- E5, en el servidor de la casa (esta máquina no lo es). En orden:
  1. Seguir `deploy/SETUP-SERVIDOR.md`: Docker, GPU NVIDIA si hay, discos montados con dueño `1000:1000`, subdominio de DuckDNS apuntando a la IP local y el token en `.env`.
  2. Copiar `deploy/` a `/opt/galeria`, completar `.env` desde `.env.example` (`GHCR_OWNER=mateodi9z`, `TAG=latest` o `TAG=sha-54b7e7a`) y correr `./deploy.sh`.
  3. Abrir `https://` más el dominio, desde el wifi de casa, y completar el asistente con los datos reales.
  4. Probar en dispositivos: instalar la PWA en Android y compartir desde la galería, subir desde un iPhone (Atajo) y desde una compu, y, si hay tele, el Chromecast. Con GPU, el log del worker tiene que decir que detectó NVENC.
  5. Dejar en `fixtures-reales/` un `.heic` y un `.MOV` HDR reales de iPhone y volver a pasar el pipeline.

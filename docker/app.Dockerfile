# Imagen de app y worker (misma imagen, distinto comando). PÚBLICA en GHCR: nada de secretos ni datos.
# Etapas:
#   base  → bun + herramientas de medios (vips/libheif, exiftool, jellyfin-ffmpeg)  [coordinador, E1]
#   dev   → base + encoder HEIC para generar fixtures; corre fixtures y test:media    [coordinador, E1]
#   prod  → build de la web + servidor                                              [infra, E2]
ARG BUN_IMAGE=oven/bun:1.4.3-debian

FROM ${BUN_IMAGE} AS base
ARG JELLYFIN_FFMPEG=jellyfin-ffmpeg7=7.1.4-3-trixie
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
      libvips-tools libheif-plugin-libde265 libimage-exiftool-perl \
 && curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /usr/share/keyrings/jellyfin.gpg \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/keyrings/jellyfin.gpg] https://repo.jellyfin.org/debian $VERSION_CODENAME main" \
      > /etc/apt/sources.list.d/jellyfin.list \
 && apt-get update && apt-get install -y --no-install-recommends ${JELLYFIN_FFMPEG} \
 && apt-get purge -y gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV PATH=/usr/lib/jellyfin-ffmpeg:$PATH
WORKDIR /app

FROM base AS dev
RUN apt-get update \
 && apt-get install -y --no-install-recommends libheif-examples libheif-plugin-x265 git \
 && rm -rf /var/lib/apt/lists/*

# --- prod ---------------------------------------------------------------------------------------

# Solo los package.json, para que la capa de dependencias se cachee mientras no cambie el lockfile.
FROM ${BUN_IMAGE} AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# Todas las dependencias + build de la web (Vite) → apps/web/dist.
# --ignore-scripts: el `prepare` de la raíz configura los hooks de git, que acá no existen.
FROM manifests AS build
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN cd apps/web && if grep -q '"build"' package.json; then bun run build; else bun --bun vite build; fi

# Solo dependencias de producción (linker aislado: hay node_modules en cada workspace).
FROM manifests AS prod-deps
RUN bun install --frozen-lockfile --production --ignore-scripts

# GeoNames cities500 (datos públicos, CC BY 4.0). Queda fijo en la capa hasta el próximo build sin caché.
FROM ${BUN_IMAGE} AS geonames
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && curl -fsSL -o /tmp/cities500.zip https://download.geonames.org/export/dump/cities500.zip \
 && mkdir -p /opt/geonames && unzip -j /tmp/cities500.zip cities500.txt -d /opt/geonames \
 && rm /tmp/cities500.zip

FROM base AS prod
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_FAST_PATH=/data/fast \
    DATA_BULK_PATHS=/data/bulk1 \
    WEB_DIST=/app/apps/web/dist \
    GEONAMES_PATH=/opt/geonames/cities500.txt
COPY --from=geonames /opt/geonames /opt/geonames
COPY --from=prod-deps /app/ /app/
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY --from=build /app/apps/web/dist apps/web/dist
# Corre como el usuario `bun` de la imagen base (UID/GID 1000): las carpetas de datos del host
# tienen que ser de 1000:1000 (ver deploy/SETUP-SERVIDOR.md). /data existe para que los volúmenes
# con nombre nazcan con ese dueño.
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
# Al final, para no invalidar la caché de las capas de arriba en cada commit.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
CMD ["bun", "apps/server/src/main.ts", "api"]

# Imagen de app y worker (misma imagen, distinto comando). PÚBLICA en GHCR: nada de secretos ni datos.
# Etapas:
#   base  → bun + herramientas de medios (vips/libheif, exiftool, jellyfin-ffmpeg)  [coordinador, E1]
#   dev   → base + encoder HEIC para generar fixtures; corre fixtures y test:media    [coordinador, E1]
#   prod  → build de la web + servidor                                              [infra, E2]

FROM oven/bun:1.4.3-debian AS base
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

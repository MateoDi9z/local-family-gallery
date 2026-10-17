# Caddy con el módulo DNS de DuckDNS (certificado por desafío DNS-01, sin exponer nada a internet).
# PÚBLICA en GHCR: el dominio y el token entran por variables de entorno al correr (ver docker/Caddyfile).
ARG CADDY_VERSION=2.11.7

FROM caddy:${CADDY_VERSION}-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns@v0.5.0

FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY docker/Caddyfile /etc/caddy/Caddyfile

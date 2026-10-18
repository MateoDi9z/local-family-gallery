#!/usr/bin/env bash
# Le avisa a DuckDNS la IP local actual del servidor, así el dominio la sigue aunque el router se la cambie.
# Reemplaza a la reserva DHCP del router. Lo corre galeria-ip.timer cada 5 minutos.
set -euo pipefail
cd "$(dirname "$0")"

envval() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
domain=$(envval DOMAIN)
token=$(envval DUCKDNS_TOKEN)
[[ -n "$domain" && -n "$token" ]] || { echo "ERROR: faltan DOMAIN o DUCKDNS_TOKEN en .env" >&2; exit 1; }

# La IP con la que la PC sale a la red de casa (no las redes internas de Docker).
ip=$(ip -4 route get 1.1.1.1 | sed -nE 's/.* src ([0-9.]+).*/\1/p')
[[ -n "$ip" ]] || { echo "ERROR: la PC no tiene IP en la red de casa. ¿Está conectada?" >&2; exit 1; }

# La URL va por stdin y no como argumento, para que el token no aparezca en `ps`.
res=$(printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip=%s"\n' "${domain%.duckdns.org}" "$token" "$ip" |
  curl -fsS --max-time 30 -K -)
[[ "$res" == OK ]] || { echo "ERROR: DuckDNS respondió '$res'. Revisá DOMAIN y DUCKDNS_TOKEN en .env." >&2; exit 1; }
echo "DuckDNS: $domain → $ip"

#!/usr/bin/env bash
# Despliega (o actualiza) la galería: pull de imágenes, migraciones, up y espera a que responda.
# Se puede correr las veces que haga falta: si no cambió nada, no reinicia nada.
#
#   ./deploy.sh                      despliega la versión de .env (latest por defecto)
#   TAG=sha-xxxxxxx ./deploy.sh      vuelve (o salta) a una versión puntual
#   NO_PULL=1 ./deploy.sh            usa las imágenes que ya están en la máquina
#   ONLY_IF_NEW=1 ./deploy.sh        no hace nada si no hay imagen nueva (lo usa el timer)
#   HEALTH_TIMEOUT=300 ./deploy.sh   segundos a esperar /api/health (120 por defecto)
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n==> %s\n' "$*"; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

[[ -f .env ]] || die "Falta .env. Copiá .env.example a .env y completalo (ver SETUP-SERVIDOR.md)."
command -v docker >/dev/null || die "Docker no está instalado."
docker compose version >/dev/null 2>&1 || die "Falta el plugin 'docker compose'."

files=(-f docker-compose.yml)
if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
  files+=(-f docker-compose.gpu.yml)
  say "GPU NVIDIA detectada: el worker la va a usar."
else
  say "Sin GPU NVIDIA: los videos se convierten con la CPU."
fi
dc() { docker compose "${files[@]}" "$@"; }

# Lee una variable de .env sin ejecutarlo (y sin pisar lo que venga del entorno, como TAG).
envval() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }

# Los discos tienen que existir: si no, Docker los crea vacíos como root y la app no puede escribir.
while read -r var; do
  dir=$(envval "$var")
  [[ -d "$dir" ]] || die "$var=$dir no existe. ¿Está montado el disco? (ver SETUP-SERVIDOR.md)"
  owner=$(stat -c %u "$dir" 2>/dev/null || stat -f %u "$dir") # GNU (Linux) o BSD (Mac, para probar)
  [[ "$owner" == 1000 ]] || echo "AVISO: $dir es del usuario $owner; la app corre como 1000. Si falla: sudo chown -R 1000:1000 $dir"
done < <(grep -oE '^HOST_[A-Z0-9_]+_PATH' .env | sort -u)

dc config -q || die "docker-compose.yml o .env tienen un error (mirá el mensaje de arriba)."

image_ids() {
  dc config --images | sort -u | while read -r img; do
    docker image inspect -f '{{.Id}}' "$img" 2>/dev/null || echo none
  done
}

if [[ "${NO_PULL:-0}" != 1 ]]; then
  before=$(image_ids)
  say "Bajando imágenes (versión ${TAG:-$(envval TAG)})..."
  dc pull --quiet || die "No se pudieron bajar las imágenes. ¿Hiciste 'docker login ghcr.io'? ¿Existe ese TAG?"
  if [[ "${ONLY_IF_NEW:-0}" == 1 && "$before" == "$(image_ids)" && -n "$(dc ps -q app)" ]]; then
    say "No hay versión nueva. Nada que hacer."
    exit 0
  fi
fi

say "Aplicando migraciones de la base..."
dc run --rm --no-deps app bun apps/server/src/main.ts migrate || die "Fallaron las migraciones. La versión anterior sigue corriendo."

say "Levantando servicios..."
dc up -d --remove-orphans

timeout=${HEALTH_TIMEOUT:-120}
say "Esperando que la app responda (hasta ${timeout} s)..."
for ((i = 0; i < timeout; i += 3)); do
  if health=$(dc exec -T app curl -fsS http://127.0.0.1:3000/api/health 2>/dev/null); then
    say "Listo: $health"
    dc ps
    echo
    echo "Abrí https://$(envval DOMAIN) desde un dispositivo de la casa."
    exit 0
  fi
  sleep 3
done

dc ps
dc logs --tail 50 app
die "La app no respondió en ${timeout} s. Para volver a la versión anterior: TAG=sha-xxxxxxx ./deploy.sh"

# Instalar la galería en el servidor

Guía paso a paso para un servidor **Debian o Ubuntu** (amd64) dentro de la casa. Los comandos con `sudo` piden la contraseña del servidor.

En los ejemplos:

- `ejemplo.duckdns.org` es el dominio: reemplazalo por el tuyo;
- `192.168.0.10` es la IP local del servidor;
- `usuario-de-ejemplo` es el dueño del repo en GitHub, en minúsculas.

La galería **no se expone a internet**: solo se abre desde la red de casa. No hay que abrir puertos en el router.

---

## 1. Docker

Con el repositorio oficial de Docker (el `docker.io` de Debian suele venir viejo y sin `docker compose`):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
. /etc/os-release   # $ID es debian o ubuntu
sudo curl -fsSL https://download.docker.com/linux/$ID/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"   # cerrá sesión y volvé a entrar para que tome efecto
docker run --rm hello-world
```

## 2. GPU NVIDIA (opcional)

Si el servidor no tiene placa NVIDIA, salteá este paso: los videos se convierten con la CPU (más lento, pero anda igual).

1. **Driver.** En Debian, con `contrib non-free non-free-firmware` habilitados en `/etc/apt/sources.list`:
   ```bash
   sudo apt-get install -y linux-headers-amd64 nvidia-driver firmware-misc-nonfree
   sudo reboot
   ```
   En Ubuntu: `sudo ubuntu-drivers install` y reiniciar.
   Verificá con `nvidia-smi`: tiene que mostrar la placa.
2. **NVIDIA Container Toolkit** (para que Docker vea la GPU):
   ```bash
   curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
     | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
   curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
     | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
     | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
   sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```
3. **Verificar** que un contenedor vea la GPU:
   ```bash
   docker run --rm --gpus all ubuntu nvidia-smi
   ```

`deploy.sh` detecta solo la GPU (si `nvidia-smi` anda) y se la da al worker. El worker prueba NVENC al arrancar y, si falla, usa la CPU.

## 3. Discos

Hay dos niveles:

- **rápido** (ideal un SSD): base de datos, miniaturas y versiones medianas. Unos pocos GB alcanzan para miles de fotos;
- **grande** (puede ser un HDD): originales y videos convertidos. Puede ser uno o varios discos.

Con un solo disco, los dos niveles pueden ser carpetas del mismo disco.

### Formatear un disco nuevo (BORRA TODO lo que tenga)

```bash
lsblk -f                         # identificá el disco, p. ej. /dev/sdb
sudo mkfs.ext4 -L galeria1 /dev/sdb1
```

(Si el disco no tiene partición, creala antes con `sudo fdisk /dev/sdb`: `g`, `n`, Enter tres veces, `w`.)

### Montarlo siempre en el mismo lugar (por UUID)

```bash
sudo blkid /dev/sdb1             # copiá el UUID="..."
sudo mkdir -p /mnt/disco1
echo 'UUID=<el-uuid> /mnt/disco1 ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a && df -h /mnt/disco1
```

`nofail` hace que el servidor arranque aunque el disco no esté. Por UUID, el disco se monta bien aunque cambie de puerto.

### Carpetas y permisos

La app corre como el usuario **1000:1000** dentro del contenedor. Las carpetas tienen que ser suyas:

```bash
sudo mkdir -p /srv/galeria/rapido /mnt/disco1/galeria
sudo chown -R 1000:1000 /srv/galeria/rapido /mnt/disco1/galeria
```

## 4. Dominio con DuckDNS

El dominio hace falta para tener HTTPS (sin HTTPS no se puede instalar la app ni usar Compartir o Chromecast). **Apunta a la IP local** del servidor, así que desde afuera de la casa no lleva a ningún lado.

1. Entrá a <https://www.duckdns.org> e iniciá sesión.
2. Creá un subdominio (p. ej. `ejemplo` → `ejemplo.duckdns.org`).
3. Copiá el **token** de arriba de la página: va en `.env` como `DUCKDNS_TOKEN`. Es secreto: no lo compartas ni lo subas a ningún lado.
4. La IP **local** del servidor no se carga a mano: `duckdns-ip.sh` se la avisa a DuckDNS y el timer `galeria-ip.timer` la repite cada 5 minutos (se instalan en el paso 6). Así no hace falta reserva DHCP en el router: si el router le cambia la IP al servidor, el dominio la sigue. Si tenés acceso al router, la reserva igual se puede hacer.

Caddy saca solo el certificado de Let's Encrypt por desafío DNS-01 (escribe un registro TXT en DuckDNS con el token) y lo renueva solo.

### Si el router bloquea el dominio (DNS rebinding)

Algunos routers (y algunos DNS como los de "protección") no responden nombres que apuntan a IPs privadas. Síntoma: desde un celular en el wifi, `ejemplo.duckdns.org` "no se encuentra", pero `nslookup ejemplo.duckdns.org 1.1.1.1` desde la compu devuelve `192.168.0.10`.

Opciones, de la más fácil a la más completa:

1. **Excepción en el router:** buscá "DNS rebind protection" / "protección DNS rebinding" y agregá `ejemplo.duckdns.org` a la lista de permitidos (en muchos routers con firmware tipo OpenWrt es *Rebind domain whitelist*; en otros se desactiva la protección).
2. **DNS local con override:** si tenés Pi-hole, AdGuard Home o dnsmasq, agregá un registro local `ejemplo.duckdns.org → 192.168.0.10` (en Pi-hole: *Local DNS → DNS Records*; en dnsmasq: `address=/ejemplo.duckdns.org/192.168.0.10`).
3. **Usar otro DNS en el router:** cambiar el DNS que reparte el router por uno que no filtre (p. ej. `1.1.1.1`).
4. **Sin acceso al router: DNS en cada dispositivo.** Android: *DNS privado* → `one.one.one.one`. iPhone: *Wi-Fi → (i) → Configurar DNS → Manual* → `1.1.1.1`. Compu: en Chrome, *Usar DNS seguro* → Cloudflare. El Chromecast suele usar el DNS de Google por su cuenta.

## 5. Acceso a las imágenes (GHCR)

Si las imágenes del repo son públicas, este paso no hace falta. Si son privadas:

1. En GitHub: *Settings → Developer settings → Personal access tokens → Tokens (classic)* → nuevo token con **solo** `read:packages`.
2. En el servidor:
   ```bash
   docker login ghcr.io -u <tu-usuario-de-github>
   # pegá el token como contraseña
   ```

## 6. Instalar

Copiá la carpeta `deploy/` del repo a `/opt/galeria` (desde la compu con `scp -r deploy/ servidor:/tmp/galeria`, o clonando el repo en el servidor):

```bash
sudo mkdir -p /opt/galeria
sudo cp -r /tmp/galeria/. /opt/galeria/
sudo chown -R "$USER" /opt/galeria
cd /opt/galeria
cp .env.example .env
chmod 600 .env
nano .env       # completá GHCR_OWNER, DOMAIN, DUCKDNS_TOKEN y las rutas HOST_..._PATH
./deploy.sh
```

Para que el dominio apunte al servidor y lo siga si cambia de IP (paso 4):

```bash
./duckdns-ip.sh                  # tiene que decir: DuckDNS: ejemplo.duckdns.org → 192.168.0.10
sudo cp /opt/galeria/galeria-ip.service /opt/galeria/galeria-ip.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now galeria-ip.timer
```

`deploy.sh` revisa `.env` y los discos, baja las imágenes, aplica las migraciones, levanta todo y espera a que la app responda. Lo podés correr las veces que quieras.

## 7. Primer uso

Desde un celular o compu **conectado al wifi de casa**, abrí `https://ejemplo.duckdns.org`. La primera vez aparece el asistente: nombre de la galería, miembros, ubicación de casa y PIN familiar.

La primera vez el certificado puede tardar uno o dos minutos. Si el navegador avisa que no es seguro, esperá y recargá (ver "Problemas comunes").

## 8. Actualizar y volver atrás

- **Actualizar** a la última versión: `cd /opt/galeria && ./deploy.sh`.
- **Volver a una versión anterior:** buscá el tag en GitHub (*Packages → local-family-gallery-app*, tags `sha-xxxxxxx`) y:
  ```bash
  TAG=sha-xxxxxxx ./deploy.sh
  ```
  Para que quede fija (y el timer no la vuelva a actualizar), poné `TAG=sha-xxxxxxx` en `.env`. Para volver a seguir la última: `TAG=latest`.
- Las migraciones de la base solo agregan cosas, pero **hacé un backup antes de volver atrás** entre versiones lejanas.

### Actualizaciones automáticas (opcional)

Un timer de systemd revisa todos los días a la madrugada si hay imagen nueva y despliega solo si cambió:

```bash
sudo cp /opt/galeria/galeria-update.service /opt/galeria/galeria-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now galeria-update.timer
systemctl list-timers galeria-update.timer     # próxima ejecución
journalctl -u galeria-update.service           # qué hizo
```

## 9. Backups

Lo importante, en orden:

1. **Los originales** (`HOST_BULK..._PATH`, carpeta `originales/`): son las fotos. Copialos a otro disco o a otra máquina, por ejemplo con `rsync -a --delete` en un cron semanal, o mejor con una herramienta con versiones (restic, borg).
2. **La base de datos** (`HOST_FAST_PATH/db/`): viajes, lugares, miembros, favoritos. Copiala en caliente con:
   ```bash
   docker compose exec app rm -f /data/fast/db/backup.sqlite   # VACUUM INTO no pisa un archivo existente
   docker compose exec app bun -e 'const {Database}=require("bun:sqlite");new Database("/data/fast/db/galeria.sqlite").exec("VACUUM INTO \"/data/fast/db/backup.sqlite\"")'
   ```
   y guardá `backup.sqlite` junto con los originales.
3. **`.env`**: tiene el token; guardalo en un lugar seguro (gestor de contraseñas).

Las miniaturas, versiones medianas y videos convertidos se pueden regenerar: no hace falta respaldarlos.

Aunque la app desaparezca, los originales quedan en carpetas por fecha con nombres legibles.

## 10. Agregar un disco

1. Formatealo y montalo por UUID (paso 3), p. ej. en `/mnt/disco2`, con una carpeta `galeria` de 1000:1000.
2. En `.env`:
   ```
   HOST_BULK2_PATH=/mnt/disco2/galeria
   DATA_BULK_PATHS=/data/bulk1,/data/bulk2
   ```
3. En `docker-compose.yml`, en `x-data-volumes`, agregá:
   ```yaml
   - ${HOST_BULK2_PATH:?Falta HOST_BULK2_PATH}:/data/bulk2
   ```
4. `./deploy.sh`. Lo nuevo se guarda en el disco con más espacio libre; lo que ya estaba queda donde está.

## 11. Problemas comunes

| Síntoma | Qué hacer |
|---|---|
| `deploy.sh` dice que una ruta no existe | El disco no está montado: `sudo mount -a` y `df -h`. Revisá el UUID en `/etc/fstab`. |
| La app no arranca y en los logs dice *permission denied* | `sudo chown -R 1000:1000 <la ruta>` y `./deploy.sh`. |
| *denied* o *unauthorized* al bajar imágenes | `docker login ghcr.io` (paso 5). Revisá que `GHCR_OWNER` esté en minúsculas. |
| El navegador dice que el sitio no es seguro | Mirá `docker compose logs caddy`. Si dice algo de DuckDNS, revisá `DUCKDNS_TOKEN` y `DOMAIN`. Si dice *rate limit*, esperá una hora. |
| El celular no encuentra el dominio | DNS rebinding (paso 4). Probá `nslookup ejemplo.duckdns.org` desde la compu. |
| Andaba y dejó de encontrar el dominio | ¿Cambió la IP del servidor? `journalctl -u galeria-ip.service` muestra la última que se avisó a DuckDNS y `systemctl list-timers galeria-ip.timer` que el timer esté activo. |
| Los videos tardan mucho | Sin GPU es normal. Con GPU: `docker compose logs worker` tiene que decir que detectó NVENC; si no, revisá el paso 2. |
| Ver el estado | `docker compose ps` y `docker compose logs -f --tail 100 app worker`. |
| Reiniciar todo | `docker compose restart`. |
| Apagar todo | `docker compose down` (los datos quedan en los discos). |

Cuando se usa `docker compose` a mano con GPU, hay que sumar el archivo: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml ...`. `deploy.sh` lo hace solo.

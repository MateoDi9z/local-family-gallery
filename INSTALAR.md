# Instalar la galería: paso a paso

Todo lo que hay que hacer **fuera del repo**, en orden: en la web y en la PC de escritorio que va a ser el servidor. No hace falta entrar al router. El código y las imágenes ya están listos en GitHub; acá no se compila nada.

En los ejemplos (reemplazalos por los tuyos):

- `ejemplo.duckdns.org` es el dominio;
- `192.168.0.10` es la IP local de la PC;
- `usuario` es tu usuario en la PC.

Para los detalles y los casos raros está [`deploy/SETUP-SERVIDOR.md`](deploy/SETUP-SERVIDOR.md). Esta guía te dice cuándo ir ahí.

> **Nunca** pegues el token de DuckDNS, el PIN ni el dominio real en el repo, en un issue o en un chat. Van solo en el `.env` de la PC y en tu gestor de contraseñas.

---

## Parte 1 · En la web

### 1.1 GitHub: que las imágenes estén listas

- [ ] Entrá a `https://github.com/MateoDi9z/local-family-gallery/actions` y fijate que el último run de `ci` e `images` en `main` esté en verde.
- [ ] Entrá a `https://github.com/MateoDi9z?tab=packages`. Tienen que estar `local-family-gallery-app` y `local-family-gallery-caddy`, las dos **Public**.
  - Si alguna dice *Private*: abrila, andá a *Package settings → Change visibility → Public*. Si preferís dejarlas privadas, vas a necesitar un token: ver la sección 5 de `SETUP-SERVIDOR.md`.

### 1.2 DuckDNS: el dominio

El dominio hace falta para tener HTTPS, y sin HTTPS no se puede instalar la app en el celular, ni compartir fotos, ni usar el Chromecast. Apunta a la IP **local** de la PC, así que desde afuera de casa no lleva a ningún lado.

- [ ] Entrá a <https://www.duckdns.org> e iniciá sesión (con GitHub o Google).
- [ ] Creá un subdominio: escribí un nombre y tocá *add domain*. Te queda `ejemplo.duckdns.org`.
- [ ] Copiá el **token** de arriba de la página y guardalo en tu gestor de contraseñas.
- La IP no la cargues a mano: la carga sola la PC (paso 3.9).

### 1.3 (Opcional) Lista privada del repo público

Sirve para que la guardia de GitHub frene cualquier commit que tenga tus datos reales.

- [ ] En GitHub: *Settings → Secrets and variables → Actions → New repository secret*. Nombre: `PRIVATE_DENYLIST`. Valor: un término por línea (tu subdominio de DuckDNS, la IP pública de tu casa, los nombres reales de la familia).

---

## Parte 2 · La red de casa (sin tocar el router)

### 2.1 La IP de la PC

El router le da a la PC una IP local (en esta guía, `192.168.0.10`) y a veces se la cambia. No hace falta fijarla: la PC le avisa a DuckDNS su IP cada 5 minutos (se activa en el paso 3.9) y el dominio la sigue sola.

- Si tenés acceso al router, igual podés reservarle la IP ("reserva DHCP" o "IP fija"). Es opcional.

### 2.2 Si el celular no encuentra el dominio (lo vas a saber en la parte 4)

Algunos routers bloquean los dominios que apuntan a una IP de la casa ("protección DNS rebinding"). Sin entrar al router se arregla en cada dispositivo, cambiándole el DNS por el de Cloudflare:

- [ ] **Android:** Ajustes → Redes e Internet (en Samsung: Conexiones → Más ajustes de conexión) → **DNS privado** → *Nombre de host del proveedor* → `one.one.one.one`.
- [ ] **iPhone:** Ajustes → Wi-Fi → la (i) del wifi de casa → **Configurar DNS** → Manual → borrá los que hay y agregá `1.1.1.1`.
- [ ] **Compu:** en Chrome, Configuración → Privacidad y seguridad → Seguridad → **Usar DNS seguro** → Cloudflare.
- La tele (Chromecast) suele usar el DNS de Google por su cuenta, así que normalmente no hace falta nada.

Si tenés acceso al router, alcanza con hacerlo una vez ahí: buscá "DNS rebind" y agregá `ejemplo.duckdns.org` a la lista de permitidos. Más opciones en la sección 4 de `SETUP-SERVIDOR.md`.

---

## Parte 3 · En la PC de escritorio (el servidor)

La PC queda prendida siempre, conectada al router (mejor por cable que por wifi).

### 3.1 Linux

La galería corre en **Debian 13** o **Ubuntu LTS** (24.04 o más nueva), de 64 bits. Si la PC ya tiene uno de los dos, salteá este paso.

- [ ] Bajá la imagen: Debian (`https://www.debian.org/download`) o Ubuntu Server (`https://ubuntu.com/download/server`).
- [ ] Grabala en un pendrive con [balenaEtcher](https://etcher.balena.io) o Rufus (**borra el pendrive**).
- [ ] Arrancá la PC desde el pendrive (al prender, F12, F11 o Esc para elegir el arranque) e instalá. **Borra el disco que elijas.**
  - En Debian, en "Selección de programas", marcá **servidor SSH** y **utilidades estándar**. El escritorio es opcional.
  - En Ubuntu Server, marcá **Install OpenSSH server**.
- [ ] (Recomendado) En el BIOS, buscá "Restore on AC Power Loss" y ponelo en **Power On**: si se corta la luz, la PC vuelve a prender sola.

Desde acá, todo se puede hacer desde otra compu de la casa con `ssh usuario@192.168.0.10`. La IP de la PC la ves en la PC con `ip -4 addr`.

### 3.2 Que no se suspenda

Si tiene escritorio, Linux la suspende sola al rato y la galería deja de responder.

- [ ] Corré:
  ```bash
  sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
  ```

### 3.3 Docker

- [ ] Instalalo con el repositorio oficial:
  ```bash
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl git
  sudo install -m 0755 -d /etc/apt/keyrings
  . /etc/os-release
  sudo curl -fsSL https://download.docker.com/linux/$ID/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
  ```
- [ ] Cerrá sesión y volvé a entrar (o reiniciá), y probá:
  ```bash
  docker run --rm hello-world
  ```

### 3.4 (Opcional) Placa de video NVIDIA

Solo si la PC tiene una placa NVIDIA. Hace mucho más rápida la conversión de videos. Sin placa, todo anda igual con el procesador.

- [ ] Seguí la sección 2 de `SETUP-SERVIDOR.md` (driver, NVIDIA Container Toolkit y la prueba con `nvidia-smi`).

### 3.5 Carpetas para las fotos

**Con un solo disco** (lo más simple):

- [ ] Corré:
  ```bash
  sudo mkdir -p /srv/galeria/rapido /srv/galeria/disco1
  sudo chown -R 1000:1000 /srv/galeria
  ```

**Con discos aparte** (un SSD para lo rápido y uno o más discos grandes para los originales): seguí la sección 3 de `SETUP-SERVIDOR.md`. Explica cómo formatear (borra el disco), montarlo siempre en el mismo lugar y darle permisos. Anotá las rutas que uses.

### 3.6 Bajar la carpeta de instalación

- [ ] Corré:
  ```bash
  git clone --depth 1 https://github.com/MateoDi9z/local-family-gallery.git /tmp/lfg
  sudo mkdir -p /opt/galeria
  sudo cp -r /tmp/lfg/deploy/. /opt/galeria/
  sudo chown -R "$USER" /opt/galeria
  rm -rf /tmp/lfg
  ```

### 3.7 Completar la configuración

- [ ] Corré:
  ```bash
  cd /opt/galeria
  cp .env.example .env
  chmod 600 .env
  nano .env
  ```
- [ ] Cambiá estas líneas (el resto se deja como está):

  | Variable | Qué poner |
  |---|---|
  | `GHCR_OWNER` | `mateodi9z` |
  | `DOMAIN` | tu subdominio, p. ej. `ejemplo.duckdns.org` |
  | `DUCKDNS_TOKEN` | el token del paso 1.2 |
  | `HOST_FAST_PATH` | `/srv/galeria/rapido` (o la ruta de tu SSD) |
  | `HOST_BULK1_PATH` | `/srv/galeria/disco1` (o la ruta de tu disco grande) |

- [ ] Guardá con `Ctrl+O`, Enter, y salí con `Ctrl+X`.

### 3.8 Instalar y arrancar

- [ ] Corré:
  ```bash
  cd /opt/galeria
  ./deploy.sh
  ```
- [ ] Al final tiene que decir `Listo: {"ok":true,...}` y `Abrí https://ejemplo.duckdns.org desde un dispositivo de la casa.`
  - Si dice que una ruta no existe o que no puede bajar las imágenes, mirá "Si algo falla" más abajo.

La galería arranca sola cada vez que se prende la PC: no hay que volver a correr nada.

### 3.9 Que el dominio apunte a la PC

- [ ] Corré:
  ```bash
  cd /opt/galeria
  ./duckdns-ip.sh
  ```
- [ ] Tiene que decir `DuckDNS: ejemplo.duckdns.org → 192.168.0.10` (con la IP de tu PC). Si dice `ERROR`, revisá `DOMAIN` y `DUCKDNS_TOKEN` en el `.env`.
- [ ] Dejalo andando solo, cada 5 minutos, para que el dominio siga a la PC si el router le cambia la IP:
  ```bash
  sudo cp /opt/galeria/galeria-ip.service /opt/galeria/galeria-ip.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now galeria-ip.timer
  ```

---

## Parte 4 · Primer uso (desde el celular, en el wifi de casa)

- [ ] Con el celular **en el wifi de casa** (no con datos), abrí `https://ejemplo.duckdns.org`.
  - La primera vez, el certificado puede tardar uno o dos minutos. Si dice "no es seguro", esperá y recargá.
  - Si dice que no encuentra la página, mirá el paso 2.2.
- [ ] Completá el asistente: nombre de la galería, las personas de la familia (nombre y color), la casa en el mapa y el PIN familiar (4 a 8 números).
- [ ] Revisá en **Más → Administración**:
  - **Discos** muestra el disco rápido y el grande, con el espacio libre de cada uno;
  - **Procesamiento** dice `Placa de video: sí` si hiciste el paso 3.4, o `no (usa el procesador)` si no.

---

## Parte 5 · Cada dispositivo de la familia

Los pasos para la familia, sin tecnicismos, están en [`GUIA-FAMILIA.md`](GUIA-FAMILIA.md). Pasales ese archivo y la dirección. En resumen:

- [ ] Si en el paso 2.2 tuviste que cambiar el DNS, hacelo en cada celular y compu de la familia.

- [ ] **Android:** abrir la dirección en Chrome → menú (tres puntos) → **Instalar app**. Después, desde la Galería del celular: Compartir → la galería.
- [ ] **iPhone:** abrir la dirección en Safari → Compartir → **Agregar a inicio**. Para subir desde Fotos: en la galería, **Más → Subir desde iPhone** y seguir los pasos. Se arma un Atajo por persona.
- [ ] **Mac o Windows:** abrir la dirección en el navegador → **Subir** → arrastrar la carpeta.
- [ ] **Tele:** el Chromecast tiene que estar en el mismo wifi. El botón **Ver en la tele** aparece en Chrome (Android o compu), no en el iPhone.

Pendiente del plan: subí desde un iPhone una foto HEIC y un video con ubicación (grabado con la cámara normal, que suele ser HDR). Tienen que aparecer en el lugar correcto del mapa, y el video no tiene que verse lavado ni gris.

---

## Parte 6 · Dejarlo andando solo

### 6.1 Actualizaciones automáticas (recomendado)

Cada madrugada revisa si hay una versión nueva y la instala sola.

- [ ] Corré:
  ```bash
  sudo cp /opt/galeria/galeria-update.service /opt/galeria/galeria-update.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now galeria-update.timer
  ```

Para actualizar a mano en cualquier momento: `cd /opt/galeria && ./deploy.sh`.

### 6.2 Copias de seguridad

Lo único que no se puede recuperar son **los originales** y **la base de datos**.

- [ ] Prepará un disco aparte (otro disco en la PC, uno externo o una NAS) y seguí la sección 9 de `SETUP-SERVIDOR.md`: copiar la carpeta `originales/` y hacer el backup de la base.
- [ ] Guardá una copia del `.env` en tu gestor de contraseñas.

---

## Si algo falla

| Qué pasa | Qué hacer |
|---|---|
| `deploy.sh`: "… no existe" | La carpeta o el disco no está. Revisá el paso 3.5 y las rutas del `.env`. |
| `deploy.sh`: "No se pudieron bajar las imágenes" | Revisá el paso 1.1 (paquetes públicos) y que `GHCR_OWNER=mateodi9z` esté en minúsculas. |
| La app no arranca y los logs dicen *permission denied* | `sudo chown -R 1000:1000 /srv/galeria` (o tus rutas) y `./deploy.sh`. |
| "No es seguro" después de varios minutos | `cd /opt/galeria && docker compose logs caddy`. Suele ser el token o el dominio mal escritos en `.env`. |
| El celular no encuentra el dominio | Que el celular esté en el wifi de casa. Después, el paso 2.2. |
| Andaba y de un día para otro no encuentra el dominio | ¿Hiciste el paso 3.9? `journalctl -u galeria-ip.service` muestra qué IP le avisó la PC a DuckDNS. |
| La galería dejó de responder | ¿La PC está prendida y sin suspender (paso 3.2)? Probá `cd /opt/galeria && docker compose ps`. |

Más casos en la sección 11 de `SETUP-SERVIDOR.md`.

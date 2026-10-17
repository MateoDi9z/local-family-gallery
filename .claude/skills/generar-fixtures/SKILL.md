---
name: generar-fixtures
description: Generar o ampliar los medios sintéticos de fixtures/ y su manifiesto. Usar cuando un test necesita un archivo nuevo (otro formato, otra metadata).
---

1. Editá `scripts/fixtures.ts` (función `generate`). Nunca copies un archivo real a `fixtures/`.
2. Privacidad: GPS solo de `PLACES` (monumentos públicos), cámara `"Cámara de ejemplo"`, fechas genéricas.
3. Cada archivo ≤ 2 MB. HEIC rotado: JPEG con `Orientation=6` → `heif-enc` (caja `irot`). HDR: convertido a HLG con zscale, no solo etiquetado. GPS en MOV: `exiftool -n` sobre la key `GPSCoordinates` del grupo Keys (sin `-n` no se escribe).
4. `bun run fixtures` (corre en Docker y reescribe `fixtures/manifest.json`).
5. Verificá con `exiftool -n -T -GPSLatitude -GPSLongitude -DateTimeOriginal -CreationDate fixtures/*` y commiteá archivos + manifiesto juntos (la guardia rechaza fixtures fuera del manifiesto).

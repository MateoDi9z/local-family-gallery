// Textos del servidor que ve la familia (nombres de viajes, errores de procesamiento, respuestas de la API).
// Español por defecto, todos juntos para poder traducirlos después.

export const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

export const texts = {
  tripName: (place: string, month: number, year: number) => `${place}, ${MONTHS[month]} ${year}`,
  tripWithoutPlace: "Viaje",
  defaultGalleryName: "Galería Familiar Local",
  mediaError: {
    extract_metadata: "No pudimos leer este archivo. Puede estar dañado o en un formato que no conocemos.",
    thumb: "No pudimos armar la miniatura de esta foto. Puede estar dañada.",
    video_poster: "No pudimos leer este video. Puede estar dañado o en un formato que no conocemos.",
  } as Record<string, string>,
  workerDied: "El procesamiento se cortó varias veces (el worker se reinició).",
  http: {
    notFound: "No encontramos esa foto o video.",
    tripNotFound: "No encontramos ese viaje.",
    placeNotFound: "No encontramos ese lugar.",
    confirmMismatch: "El nombre no coincide. Escribilo igual que el del lugar para borrar.",
    pairNotFound: "No encontramos ese par de fotos.",
    memberRequired: "Primero elegí quién sos en este dispositivo.",
    badCursor: "La página pedida no es válida. Volvé a cargar.",
  },
};

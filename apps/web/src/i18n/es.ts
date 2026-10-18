// Todos los textos de la interfaz. Español por defecto; nunca strings sueltos en componentes.
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const es = {
  appName: "Galería Familiar Local",
  appShortName: "Galería",
  appDescription: "Las fotos y videos de los viajes de la familia, en un solo lugar.",
  loading: "Cargando…",
  serverDown: "No podemos conectar con la galería. Fijate que estés en el wifi de casa.",
  retry: "Probar de nuevo",
  back: "Volver",
  cancel: "Cancelar",
  save: "Guardar",
  saved: "Guardado",
  close: "Cerrar",
  next: "Siguiente",
  done: "Listo",
  all: "Todos",

  errors: {
    offline: "Se cortó el wifi. Cuando vuelva, probá de nuevo.",
    generic: "Algo salió mal. Probá de nuevo en un rato.",
    pinWrong: "Ese PIN no es. Probá de nuevo.",
    notFound: "No encontramos eso.",
    invalid: "Faltan datos o hay alguno mal escrito.",
  },

  nav: {
    label: "Secciones",
    map: "Mapa",
    trips: "Viajes",
    upload: "Subir",
    home: "Inicio",
    more: "Más",
  },

  setup: {
    title: "¡Bienvenidos!",
    intro: "Vamos a preparar la galería en cuatro pasos cortos.",
    step: (n: number, total: number) => `Paso ${n} de ${total}`,
    nameTitle: "¿Cómo se llama la galería?",
    nameHelp: "Se ve en la portada. Lo podés cambiar después.",
    nameDefault: "Galería Familiar Local",
    membersTitle: "¿Quiénes son?",
    membersHelp: "Cada persona elige un color. Se pueden agregar más después.",
    memberName: (n: number) => `Nombre de la persona ${n}`,
    memberPlaceholder: (n: number) => `Persona ${n}`,
    memberColor: (n: number) => `Color de la persona ${n}`,
    addMember: "Agregar otra persona",
    removeMember: "Quitar",
    homeTitle: "¿Dónde queda la casa?",
    homeHelp: "Tocá el mapa en el lugar de la casa. Sirve para separar las fotos de viaje de las de todos los días.",
    homeMissing: "Tocá el mapa para marcar la casa.",
    homeMarked: "Casa marcada.",
    pinTitle: "Elegí un PIN familiar",
    pinHelp: "De 4 a 8 números. Se pide una sola vez en cada celular o compu.",
    pin: "PIN",
    pinAgain: "Repetí el PIN",
    pinMismatch: "Los dos PIN no son iguales.",
    pinShort: "El PIN tiene que tener de 4 a 8 números.",
    finish: "Terminar",
    saving: "Guardando…",
  },

  pin: {
    title: "Escribí el PIN familiar",
    help: "Se pide una sola vez en este dispositivo.",
    digit: (d: string) => `Número ${d}`,
    erase: "Borrar",
    enter: "Entrar",
    shown: (n: number) => `${n} números escritos`,
  },

  who: {
    title: "¿Quién sos?",
    help: "Lo preguntamos una sola vez en este dispositivo.",
    change: "Cambiar de persona",
  },

  upload: {
    title: "Subir fotos y videos",
    pick: "Elegir fotos y videos",
    pickFolder: "Elegir una carpeta",
    drop: "O arrastrá acá archivos o carpetas enteras",
    dropActive: "Soltalos acá",
    macTitle: "Desde la app Fotos de la Mac",
    macHelp:
      "Elegí las fotos, andá a Archivo › Exportar › Exportar original sin modificar, y arrastrá la carpeta acá. Así no se pierde la ubicación ni la calidad.",
    preparing: (done: number, total: number) => `Revisando ${done} de ${total}…`,
    uploading: (done: number, total: number) => `Subiendo ${done} de ${total}`,
    skipped: (n: number) => `${plural(n, "ya estaba", "ya estaban")} en la galería, no se suben de nuevo.`,
    allExisted: "Todo eso ya estaba en la galería.",
    noMedia: "No encontramos fotos ni videos en lo que elegiste.",
    offline: "Se cortó el wifi, la subida va a seguir sola.",
    stalled: "La subida va lenta, pero sigue.",
    failed: (n: number) => `${plural(n, "archivo no se pudo", "archivos no se pudieron")} subir.`,
    retryFailed: "Reintentar",
    finished: "¡Listo! Ya se subió todo.",
    seeSummary: "Ver el resumen",
    keepOpen: "Dejá esta pantalla abierta hasta que termine.",
    inProgress: (done: number, total: number) => `Subiendo ${done} de ${total}`,
    another: "Subir más",
    shareTitle: "Recibiendo lo que compartiste",
    shareEmpty: "No llegó ningún archivo. Probá compartir de nuevo.",
  },

  summary: {
    title: "Resumen de la subida",
    uploaded: (n: number, place: string | null) =>
      place
        ? `Subiste ${plural(n, "foto o video", "fotos y videos")} de ${place}.`
        : `Subiste ${plural(n, "foto o video", "fotos y videos")}.`,
    duplicates: (n: number) => `${plural(n, "ya estaba", "ya estaban")} en la galería.`,
    processing: (n: number) => `Preparando ${plural(n, "archivo", "archivos")}… ya casi.`,
    noLocation: (n: number) =>
      `${n} ${n === 1 ? "no tiene ubicación: ¿es de acá?" : "no tienen ubicación: ¿son de acá?"}`,
    allLocated: "Todas tienen ubicación.",
    suggestion: (place: string | null) => (place ? `¿Es de ${place}?` : "Tenemos un lugar sugerido."),
    confirm: "Sí",
    confirmAll: "Confirmar todas las sugerencias",
    areFrom: (place: string) => `Sí, son de ${place}`,
    select: "Elegir",
    selected: (n: number) => `${plural(n, "elegida", "elegidas")}`,
    pickOnMap: "Elegir el lugar en el mapa",
    assignSelected: "Poner este lugar a las elegidas",
    assignAll: "Poner este lugar a todas",
    mapHelp: "Tocá el mapa donde se sacaron las fotos.",
    assigned: "¡Listo! Ubicación guardada.",
    toMap: "Ver en el mapa",
  },

  globe: {
    title: "Mapa",
    empty: "Todavía no hay fotos con ubicación. ¡Subí las primeras!",
    places: "Lugares",
    placeCount: (name: string, n: number) => `${name}: ${plural(n, "foto", "fotos")}`,
    cluster: (n: number) => `${plural(n, "foto", "fotos")} en esta zona. Tocá para acercarte.`,
  },

  gallery: {
    noTrip: "Fotos de todos los días",
    count: (n: number) => plural(n, "foto", "fotos"),
    processing: "Preparando…",
    empty: "No hay fotos para mostrar.",
    filterLabel: "Mostrar fotos de",
    open: (name: string) => `Abrir ${name}`,
    video: "Video",
  },

  select: {
    start: "Elegir",
    label: "Fotos elegidas",
    count: (n: number) => (n === 0 ? "Tocá las fotos que querés borrar" : `${plural(n, "elegida", "elegidas")}`),
    all: "Todas",
    none: "Ninguna",
    delete: "Borrar",
    download: "Descargar",
    downloading: (i: number, n: number) => `Descargando ${i} de ${n}…`,
    downloaded: (n: number) => `Listo: ${plural(n, "foto descargada", "fotos descargadas")}.`,
    share: "Compartir",
    shareTitle: (n: number) => `Compartir ${plural(n, "foto", "fotos")}`,
    preparing: (i: number, n: number) => `Preparando ${i} de ${n}…`,
    shareReady: (ios: boolean) =>
      ios
        ? "Listas. Tocá «Compartir»; para guardarlas en Fotos, elegí «Guardar imágenes»."
        : "Listas. Tocá «Compartir» y elegí dónde mandarlas.",
    tooBig: "Son demasiadas para compartir juntas. Elegí menos, o usá «Descargar».",
    confirmTitle: (n: number) => `¿Borrar ${plural(n, "foto", "fotos")}?`,
    confirmBody: "Se van a quitar de la galería para todos. Los originales quedan en la papelera del servidor.",
    confirm: (n: number) => `Sí, borrar ${plural(n, "foto", "fotos")}`,
    busy: "Borrando…",
  },

  deletePlace: {
    button: "Borrar todas las fotos de este lugar",
    title: (name: string) => `¿Borrar todo lo de ${name}?`,
    body: (n: number) =>
      `Se van a quitar ${plural(n, "foto o video", "fotos y videos")} de la galería, para todos. Los originales quedan en la papelera del servidor.`,
    typeLabel: "Para confirmar, escribí el nombre del lugar:",
    confirm: (n: number) => `Borrar ${plural(n, "foto", "fotos")}`,
    busy: "Borrando…",
  },

  viewer: {
    download: "Descargar original",
    downloadShort: "Descargar",
    favoriteShort: "Favorita",
    castShort: "Tele",
    stopShow: "Parar",
    startShow: "Empezar",
    airplayTitle: "Ver en la tele con AirPlay",
    airplaySteps: [
      "Abrí el Centro de control (desde la esquina de arriba a la derecha; en los iPhone con botón, desde abajo).",
      "Tocá «Duplicar pantalla» y elegí la tele.",
      "Volvé acá y tocá «Empezar»: las fotos pasan solas.",
    ],
    airplayNote: "Hace falta un Apple TV o una tele con AirPlay. Para cortar, tocá la pantalla y después «Parar».",
    favorite: "Marcar como favorita",
    unfavorite: "Quitar de favoritas",
    videoPreparing: "El video se está preparando. Probá en un ratito.",
    cast: "Ver en la tele",
    delete: "Borrar",
    deleteTitle: "¿Borrar esta foto?",
    deleteVideoTitle: "¿Borrar este video?",
    deleteBody: "Se va a quitar de la galería para todos. El original queda guardado en la papelera del servidor.",
    deleteConfirm: "Sí, borrar",
  },

  trips: {
    title: "Viajes",
    empty:
      "Todavía no hay viajes. Aparecen solos cuando hay 5 fotos o más de lejos de casa. Mientras, en «Por fecha» están todas las fotos juntas según cuándo se sacaron.",
    dates: (from: string, to: string) => (from === to ? from : `${from} al ${to}`),
    rename: "Cambiar el nombre",
    renameLabel: "Nombre del viaje",
    slideshow: "Pasar en la tele",
    slideshowShort: "Tele",
    merge: "Unir",
    split: "Separar",
    mergeTitle: "Unir con otro viaje",
    mergeHelp: "Elegí el viaje que en realidad es el mismo. Los más cercanos en fecha están primero.",
    mergeConfirm: (a: string, b: string) => `¿Unir «${a}» y «${b}»?`,
    mergeBody:
      "Van a quedar como un solo viaje, con las fotos de los dos. Las que se suban después de esos días también entran. Si te equivocás, se puede separar.",
    mergeYes: "Sí, unir",
    merging: "Un momento…",
    noOthers: "No hay otros viajes para unir.",
    splitTitle: "¿Separar este viaje?",
    splitBody: "Vuelve a quedar como se detectó al principio, en los viajes de antes de unirlo.",
    splitYes: "Sí, separar",
  },

  photos: {
    viewLabel: "Ver",
    views: { viajes: "Viajes", fecha: "Por fecha", lugar: "Por lugar" },
    help: {
      fecha: "Juntas las que se sacaron con menos de un día y medio de diferencia.",
      lugar: "Una ciudad por grupo, la más reciente primero.",
    },
    noPlace: "Sin ubicación",
    noDate: "Sin fecha",
  },

  home: {
    yearsAgo: (n: number) => `Hoy hace ${plural(n, "año", "años")}…`,
    lastTrip: "Último viaje",
    perMember: (name: string, n: number) => `${name} subió ${plural(n, "foto", "fotos")}`,
    seeMap: "Ver el mapa",
    seeTrip: "Ver el viaje",
    empty: "Acá van a aparecer el último viaje y los recuerdos de otros años. ¡Subí las fotos de un viaje!",
  },

  more: {
    title: "Más",
    noLocation: "Fotos sin ubicación",
    similar: "Fotos parecidas",
    admin: "Administración",
    status: "Estado del sistema",
    tv: "Ver en la tele",
    version: (v: string) => `Versión ${v}`,
    shortcut: "Subir desde iPhone",
    favorites: "Favoritas",
  },

  inbox: {
    noLocationTitle: "Fotos sin ubicación",
    noLocationEmpty: "Todas las fotos tienen ubicación.",
    similarTitle: "Fotos parecidas",
    similarHelp: "Estas fotos se parecen mucho. Nada se borra solo: vos decidís.",
    similarEmpty: "No hay fotos parecidas para revisar.",
    keepBoth: "Conservar las dos",
    dismiss: "Descartar sugerencia",
    deleteThis: "Borrar esta",
    confirmDeleteTitle: "¿Borrar esta foto?",
    confirmDeleteBody: "Se va a quitar de la galería para todos. La otra foto queda.",
    confirmDelete: "Sí, borrarla",
    left: "Primera",
    right: "Segunda",
  },

  admin: {
    title: "Administración",
    galleryName: "Nombre de la galería",
    members: "Personas",
    addMember: "Agregar persona",
    newMember: "Nombre de la persona nueva",
    nameOf: (name: string) => `Nombre de ${name}`,
    colorOf: (name: string) => `Color de ${name}`,
    archive: "Ocultar",
    unarchive: "Volver a mostrar",
    home: "Ubicación de casa",
    homeHelp: "Tocá el mapa para mover la casa.",
    pin: "Cambiar el PIN",
    pinNew: "PIN nuevo",
    pinAgain: "Repetí el PIN nuevo",
    queue: "Procesamiento",
    queueState: (queued: number, running: number, failed: number) =>
      `${queued} en espera · ${running} en proceso · ${failed} con error`,
    retryFailed: "Reintentar los que fallaron",
    retried: "Listo, se van a volver a procesar.",
    errors: "Errores recientes",
    noErrors: "Sin errores.",
    disks: "Discos",
    disk: (tier: string) => (tier === "fast" ? "Disco rápido" : "Disco grande"),
    diskUse: (pct: number, free: string) => `${pct} % usado · quedan ${free}`,
    diskAlert: "Este disco está casi lleno. Conviene sumar otro.",
    gpu: (nvenc: boolean) => (nvenc ? "Placa de video: sí" : "Placa de video: no (usa el procesador)"),
  },

  status: {
    title: "Estado del sistema",
    summary: {
      ok: "Todo anda bien.",
      warn: "Anda, pero hay algo para mirar.",
      bad: "Hay algo que no anda. Abajo dice qué.",
      unknown: "Revisando…",
    },
    levels: { ok: "Bien", warn: "Atención", bad: "No anda", unknown: "Sin datos" },
    checking: "Revisando…",
    unknown: "No se puede revisar ahora.",
    auto: "Se vuelve a revisar sola cada 15 segundos.",
    recheck: "Revisar de nuevo",
    device: "Este dispositivo",
    deviceOffline: "No tiene red. Conectate al wifi de casa.",
    deviceCellular: "Está con los datos del celular. La galería solo anda en el wifi de casa.",
    deviceWifi: "Conectado al wifi.",
    deviceOnline: "Conectado a la red.",
    internet: "Internet",
    internetOk: (ms: number) => `Anda (${ms} ms).`,
    internetDown: "No hay internet o el servicio de mapas no responde. La galería anda igual, pero el mapa no se ve.",
    secure: "Conexión segura",
    secureOk: "Sí.",
    secureNo: "No. Sin HTTPS no se puede instalar la app ni compartir desde el celular.",
    server: "Servidor de la galería",
    serverOk: (ms: number, version: string) => `Responde en ${ms} ms · versión ${version}.`,
    version: "Versión de la app",
    versionOk: (v: string) => `${v}.`,
    versionStale: (app: string, server: string) =>
      `Este dispositivo tiene la ${app} y el servidor la ${server}. Tocá «Actualizar la app».`,
    updateApp: "Actualizar la app",
    db: "Base de datos",
    dbOk: "Anda.",
    worker: "Procesador de fotos y videos",
    workerOk: "Funcionando.",
    workerDown: (since: string | null) =>
      `Está detenido${since ? ` desde ${since}` : ""}: las fotos nuevas no se procesan. Hay que reiniciar el servidor.`,
  },

  shortcut: {
    title: "Subir desde iPhone",
    intro: "En iPhone se sube con un Atajo que aparece al tocar Compartir en Fotos. Se arma una sola vez por persona.",
    who: "¿Para quién es?",
    label: "Nombre del iPhone",
    labelDefault: "iPhone",
    create: "Crear la clave del Atajo",
    tokenTitle: "Esta es la clave. Copiala ahora: no se vuelve a mostrar.",
    copy: "Copiar",
    copied: "Copiada",
    urlTitle: "Dirección para el Atajo",
    stepsTitle: "Cómo armar el Atajo",
    steps: [
      "Abrí la app Atajos y tocá + para crear uno nuevo. Ponele de nombre «Enviar a la galería».",
      "Tocá el ícono de información (i) y activá «Mostrar en la hoja para compartir». En tipos, dejá solo Imágenes y Multimedia.",
      "Agregá la acción «Obtener archivo original»… si no aparece, usá «Obtener contenido de» la entrada del Atajo, sin convertir.",
      "Agregá «Obtener contenido de URL». Pegá la dirección de arriba. Método: POST. Cuerpo de la solicitud: Formulario.",
      "En el formulario agregá un campo de tipo Archivo, con nombre «file», y elegí la entrada del Atajo.",
      "En Encabezados agregá «Authorization» con el valor «Bearer » seguido de la clave (con un espacio después de Bearer).",
      "Listo: en Fotos elegí fotos, tocá Compartir y «Enviar a la galería».",
    ],
    keepTitle: "Para que lleguen con ubicación y en buena calidad",
    keep: [
      "En Ajustes › Fotos › Transferir a Mac o PC, elegí «Mantener originales».",
      "En Fotos, al compartir, tocá «Opciones» y activá «Ubicación» y «Todos los datos de las fotos».",
      "En el Atajo no uses acciones de «Convertir imagen»: así el HEIC llega tal cual, con su ubicación.",
    ],
  },

  map: {
    useHere: "Usar dónde estoy ahora",
    geoError: "No pudimos saber dónde estás. Tocá el mapa.",
  },

  tv: {
    title: "Ver en la tele",
    intro:
      "Las fotos y los videos se ven en la tele: con Chromecast desde Android o una compu, y con AirPlay desde iPhone. La tele solo muestra: el celular es el control remoto.",
    checkTitle: "¿Este dispositivo puede?",
    checkConnected: (name: string) => `Sí. Está conectado a ${name}. Abrí una foto y tocá «Tele».`,
    checkReady: "Sí. Hay una tele en este wifi. Tocá «Buscar la tele» para probar.",
    checkNoDevices:
      "Este dispositivo puede, pero no encuentra ninguna tele. Fijate que la tele esté prendida y en el mismo wifi.",
    checkLoading: "Revisando… Si en un rato sigue así, actualizá Chrome.",
    checkIphone:
      "Sí, con AirPlay: hace falta un Apple TV o una tele con AirPlay, en el mismo wifi. Con un Chromecast no se puede desde iPhone.",
    checkAirplayFound: "Sí. Hay una tele con AirPlay en este wifi.",
    checkBrowser: "Con este navegador no se puede. Abrí la galería en Chrome.",
    connect: "Buscar la tele",
    troubleTitle: "Si no anda",
    chrome: {
      sections: [
        {
          title: "Qué hace falta",
          steps: [
            "Un celular Android o una compu, con Chrome.",
            "Una tele con Chromecast o Google TV, prendida.",
            "Los dos conectados al wifi de casa.",
          ],
        },
        {
          title: "Ver una foto o un video",
          steps: [
            "Abrí la foto o el video.",
            "Tocá «Tele», abajo.",
            "Elegí la tele de la lista.",
            "Abajo aparece un panel para pasar a la anterior o a la siguiente, y para pausar.",
          ],
        },
        {
          title: "Pasar todas las de un viaje o un lugar",
          steps: [
            "Entrá al viaje o al lugar.",
            "Tocá «Pasar en la tele».",
            "Las fotos pasan solas cada 6 segundos. Los videos se ven enteros y después sigue la próxima.",
          ],
        },
        {
          title: "Terminar",
          steps: ["En el panel de abajo, tocá «Dejar de ver en la tele»."],
        },
      ],
      trouble: [
        ["No aparece el botón «Tele».", "Este dispositivo no puede o no encuentra la tele: mirá el chequeo de arriba."],
        [
          "La tele no aparece en la lista.",
          "Prendé la tele, esperá un minuto y fijate que el celular y la tele estén en el mismo wifi (no con datos).",
        ],
        [
          "La tele se queda en negro o muestra un error.",
          "La tele no llega a la galería. Desenchufá el Chromecast un minuto y probá de nuevo. Si sigue, avisale a quien cuida el servidor.",
        ],
        ["Un video no arranca.", "Puede que todavía se esté preparando. Probá en unos minutos."],
      ] as [string, string][],
    },
    iphone: {
      sections: [
        {
          title: "Qué hace falta",
          steps: [
            "Un iPhone o un iPad.",
            "Un Apple TV, o una tele con AirPlay (muchas Samsung, LG, Sony y Philips de los últimos años lo traen).",
            "Los dos conectados al wifi de casa.",
          ],
        },
        {
          title: "Ver un video",
          steps: ["Abrí el video.", "Tocá «Tele», abajo.", "Elegí la tele de la lista."],
        },
        {
          title: "Ver fotos y pasarlas solas",
          steps: [
            "Abrí una foto, o entrá a un viaje o a un lugar y tocá «Pasar en la tele».",
            "Abrí el Centro de control (desde la esquina de arriba a la derecha; en los iPhone con botón, desde abajo) y tocá «Duplicar pantalla».",
            "Elegí la tele.",
            "Volvé a la galería y tocá «Empezar»: las fotos pasan solas cada 6 segundos y los videos se ven enteros.",
          ],
        },
        {
          title: "Terminar",
          steps: [
            "Tocá la pantalla y después «Parar».",
            "En el Centro de control, tocá «Duplicar pantalla» y después «Dejar de duplicar».",
          ],
        },
      ],
      trouble: [
        [
          "La tele no aparece en la lista.",
          "Tiene que tener AirPlay (o ser un Apple TV), estar prendida y en el mismo wifi que el iPhone.",
        ],
        [
          "Tengo un Chromecast.",
          "Desde iPhone no se puede mandar a un Chromecast. Usá un celular Android o una compu con Chrome.",
        ],
        ["Un video no arranca.", "Puede que todavía se esté preparando. Probá en unos minutos."],
      ] as [string, string][],
    },
  },

  cast: {
    connected: (name: string) => `Conectado a ${name}`,
    prev: "Anterior",
    next: "Siguiente",
    play: "Seguir",
    pause: "Pausar",
    stop: "Dejar de ver en la tele",
    slideshow: "Pasar en la tele",
  },

  dates: {
    locale: "es-AR",
  },
};

export type Texts = typeof es;

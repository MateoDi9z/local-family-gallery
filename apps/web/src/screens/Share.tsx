import { useEffect, useState } from "react";
import { t } from "../i18n";
import { takeSharedFiles } from "../share";
import { isMedia } from "../upload/files";
import { startUpload } from "../upload/uploader";
import { UploadProgress } from "./Upload";

// Una sola lectura por carga de página (StrictMode corre el efecto dos veces).
let taking: Promise<File[]> | null = null;

/** Llega acá después de "Compartir" en Android: sube solo, sin más pasos. */
export function Share() {
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    taking ??= takeSharedFiles();
    taking.then((files) => {
      const media = files.filter(isMedia);
      if (media.length) startUpload(media, "share");
      else setEmpty(true);
    });
  }, []);
  return (
    <main className="screen stack">
      <h1>{t.upload.shareTitle}</h1>
      {empty && <p className="notice">{t.upload.shareEmpty}</p>}
      <UploadProgress />
    </main>
  );
}

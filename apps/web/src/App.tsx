import { API_PREFIX, endpoints, HealthResponse } from "@lfg/shared";
import { useEffect, useState } from "react";
import { t } from "./i18n";

export function App() {
  const [status, setStatus] = useState<string>(t.loading);
  useEffect(() => {
    fetch(API_PREFIX + endpoints.health)
      .then((r) => r.json())
      .then((j) => setStatus(`${t.appName} · ${HealthResponse.parse(j).version}`))
      .catch(() => setStatus(t.serverDown));
  }, []);
  return <main>{status}</main>;
}

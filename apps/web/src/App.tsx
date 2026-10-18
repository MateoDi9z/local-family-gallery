import { endpoints, type Member, MeResponse, SetupStatus } from "@lfg/shared";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ApiError, api, GATE_EVENT, type GateCode } from "./api/client";
import { fetchMembers, MembersContext } from "./api/hooks";
import { CastPanel } from "./components/CastPanel";
import { t } from "./i18n";
import { Link, match, usePath } from "./router";
import { Activity } from "./screens/Activity";
import { Admin } from "./screens/Admin";
import { Failure, Loading, PlaceGallery, Timeline, TripGallery } from "./screens/Galleries";
import { Globe } from "./screens/Globe";
import { Home } from "./screens/Home";
import { NoLocation, Similar } from "./screens/Inbox";
import { More } from "./screens/More";
import { Pin } from "./screens/Pin";
import { Setup } from "./screens/Setup";
import { Share } from "./screens/Share";
import { Shortcut } from "./screens/Shortcut";
import { SystemStatus } from "./screens/Status";
import { Summary } from "./screens/Summary";
import { Tv } from "./screens/Tv";
import { Upload, UploadPill } from "./screens/Upload";
import { WhoAreYou } from "./screens/WhoAreYou";

type Gate = "loading" | "down" | "setup" | "pin" | "member" | "ready";

export function App() {
  const [gate, setGate] = useState<Gate>("loading");
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const { setupDone } = await api.get(endpoints.setupStatus, SetupStatus);
      if (!setupDone) return setGate("setup");
      const res = await api.get(endpoints.me, MeResponse);
      setMembers(await fetchMembers());
      setMe(res.member?.id ?? null);
      setGate(res.member ? "ready" : "member");
    } catch (e) {
      if (e instanceof ApiError && (e.code === "pin_required" || e.status === 401)) setGate("pin");
      else if (e instanceof ApiError && e.code === "setup_required") setGate("setup");
      else setGate("down");
    }
  }, []);

  useEffect(() => {
    check();
    const onGate = (e: Event) => {
      const code = (e as CustomEvent<GateCode>).detail;
      if (code === "pin_required") setGate("pin");
      else if (code === "setup_required") setGate("setup");
      else if (code === "member_required") check();
    };
    window.addEventListener(GATE_EVENT, onGate);
    return () => window.removeEventListener(GATE_EVENT, onGate);
  }, [check]);

  const reloadMembers = useCallback(() => {
    fetchMembers().then(setMembers, () => {});
  }, []);

  switch (gate) {
    case "loading":
      return <Loading />;
    case "down":
      return <SystemStatus down={check} />;
    case "setup":
      return <Setup onDone={check} />;
    case "pin":
      return <Pin onDone={check} />;
    case "member":
      return <WhoAreYou members={members} onDone={check} />;
    case "ready":
      return (
        <MembersContext.Provider value={members}>
          <Routes members={members} me={me} reloadMembers={reloadMembers} changeMember={() => setGate("member")} />
          <UploadPill />
          <CastPanel />
          <Nav />
        </MembersContext.Provider>
      );
  }
}

function Routes(p: { members: Member[]; me: string | null; reloadMembers: () => void; changeMember: () => void }) {
  const path = usePath().split("?")[0] ?? "/";
  const routes: [string, (params: Record<string, string>) => ReactNode][] = [
    ["/", () => <Globe />],
    ["/inicio", () => <Home />],
    ["/viajes", () => <Timeline />],
    ["/subir", () => <Upload />],
    ["/subidas", () => <Activity />],
    ["/compartir", () => <Share />],
    ["/mas", () => <More onChangeMember={p.changeMember} />],
    ["/lugar/:id", ({ id }) => <PlaceGallery key={id} id={id as string} />],
    ["/viaje/:id", ({ id }) => <TripGallery key={id} id={id as string} />],
    ["/lote/:id", ({ id }) => <Summary key={id} id={id as string} />],
    ["/sin-ubicacion", () => <NoLocation />],
    ["/parecidas", () => <Similar />],
    ["/iphone", () => <Shortcut members={p.members} me={p.me} />],
    ["/admin", () => <Admin members={p.members} onMembersChanged={p.reloadMembers} />],
    ["/estado", () => <SystemStatus />],
    ["/tele", () => <Tv />],
  ];
  for (const [pattern, render] of routes) {
    const params = match(pattern, path);
    if (params) return <>{render(params)}</>;
  }
  return <Failure text={t.errors.notFound} onRetry={() => history.back()} />;
}

const ICONS: Record<string, ReactNode> = {
  map: (
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c1.3 1.6 2.2 3.7 2.4 6H9.6c.2-2.3 1.1-4.4 2.4-6zM4.1 13h3.5c.1 2 .6 3.8 1.4 5.3A8 8 0 0 1 4.1 13zm0-2A8 8 0 0 1 9 5.7 13 13 0 0 0 7.6 11zm7.9 9c-1.3-1.6-2.2-3.7-2.4-7h4.8c-.2 3.3-1.1 5.4-2.4 7zm3-1.7c.8-1.5 1.3-3.3 1.4-5.3h3.5a8 8 0 0 1-4.9 5.3zM16.4 11c-.1-2-.6-3.8-1.4-5.3a8 8 0 0 1 4.9 5.3z" />
  ),
  trips: <path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h12v2H3z" />,
  upload: <path d="M11 16V7.8l-3.6 3.6L6 10l6-6 6 6-1.4 1.4L13 7.8V16zm-7 4v-6h2v4h12v-4h2v6z" />,
  home: <path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z" />,
  more: (
    <path d="M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
  ),
};

function Nav() {
  const path = usePath().split("?")[0] ?? "/";
  const items: [string, string, string][] = [
    ["/", "map", t.nav.map],
    ["/viajes", "trips", t.nav.trips],
    ["/subir", "upload", t.nav.upload],
    ["/inicio", "home", t.nav.home],
    ["/mas", "more", t.nav.more],
  ];
  return (
    <nav className="nav" aria-label={t.nav.label}>
      {items.map(([href, icon, label]) => (
        <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {ICONS[icon]}
          </svg>
          {label}
        </Link>
      ))}
    </nav>
  );
}

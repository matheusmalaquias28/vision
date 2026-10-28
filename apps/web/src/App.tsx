import React, { useEffect, useState } from "react";
import type { Recipe } from "@vision/recipe";
import {
  disconnectDrive,
  getMe,
  getIntegrations,
  listDemands,
  listProjects,
  setDemandStatus,
  uploadDemandVideo,
  uploadProject,
  type CurrentUser,
  type Demand,
  type Integrations,
  type ProjectSummary,
} from "./api";
import { Editor } from "./editor/Editor";
import { Icon } from "./editor/Icon";
import { MotionLabPage } from "./lab/MotionLabPage";
import { Logo } from "./ui/Logo";
import { appendClips, ClipDropzone, ClipQueue, type QueuedClip } from "./home/ClipQueue";
import { ClientsPage } from "./home/ClientsPage";
import { DemandDetail } from "./home/DemandDetail";
import { DemandsBoard } from "./home/DemandsBoard";
import { LoginPage } from "./home/LoginPage";
import { NotificationBell } from "./home/NotificationBell";
import { UserMenu } from "./home/UserMenu";
import { UsersPage } from "./home/UsersPage";
import { ConfirmButton } from "./ui/ConfirmButton";
import { UserContext, useCurrentUser } from "./ui/user";

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${fmtDate(iso)}, ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

const ProjectCard: React.FC<{ project: ProjectSummary; onOpen: () => void }> = ({
  project: p,
  onOpen,
}) => {
  // sem miniatura (ffmpeg falhou / fonte sumiu) cai no ícone
  const [thumbFailed, setThumbFailed] = useState(false);
  return (
    <button className="project-card" onClick={onOpen} title={p.id}>
      <span className="pc-thumb">
        {thumbFailed ? (
          <Icon name="film" size={20} />
        ) : (
          <img
            src={`/api/projects/${encodeURIComponent(p.id)}/thumbnail`}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        )}
        <span className="pc-badge">
          {p.clipCount > 1 && `${p.clipCount} clipes · `}
          {fmtDuration(p.durationInSeconds)}
        </span>
      </span>
      <span className="pc-name">{p.id}</span>
      <span className="pc-dates">
        <span>
          Criado <time dateTime={p.createdAt}>{fmtDate(p.createdAt)}</time>
        </span>
        <span>
          Editado <time dateTime={p.updatedAt}>{fmtDateTime(p.updatedAt)}</time>
        </span>
      </span>
    </button>
  );
};

type Route =
  | { view: "demandas"; id: string | null }
  | { view: "clientes"; id: string | null }
  | { view: "projetos" }
  | { view: "usuarios" }
  | { view: "lab" };

/** #/demandas[/id] · #/clientes[/id] · #/projetos · #lab */
function parseHash(hash: string): Route {
  if (hash === "#lab") return { view: "lab" };
  const [view, id] = hash.replace(/^#\/?/, "").split("?")[0].split("/");
  const decoded = id ? decodeURIComponent(id) : null;
  if (view === "clientes") return { view: "clientes", id: decoded };
  if (view === "projetos") return { view: "projetos" };
  if (view === "usuarios") return { view: "usuarios" };
  return { view: "demandas", id: decoded };
}

const go = (hash: string) => {
  window.location.hash = hash;
};

/** Vision depois do login */
const Workspace: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const me = useCurrentUser();
  // null = ainda carregando
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // ordem da fila = ordem dos clipes na timeline
  const [clips, setClips] = useState<QueuedClip[]>([]);
  const [briefing, setBriefing] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // muda a cada demanda concluída para forçar o editor a recarregar
  const [reloadKey, setReloadKey] = useState(0);
  const [board, setBoard] = useState<{ statuses: string[]; demands: Demand[] } | null>(null);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);

  const refresh = () => {
    listProjects().then(setProjects).catch((e) => setError(e.message));
  };
  const refreshBoard = () => {
    listDemands().then(setBoard).catch((e) => setError(e.message));
  };
  const refreshIntegrations = () => {
    getIntegrations().then(setIntegrations).catch(() => {});
  };
  useEffect(() => {
    refresh();
    refreshBoard();
    refreshIntegrations();
  }, []);

  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const route = parseHash(hash);

  // volta do login do Google: #/demandas?drive=ok|erro&msg=…
  useEffect(() => {
    const q = new URLSearchParams(hash.split("?")[1] ?? "");
    if (!q.has("drive")) return;
    if (q.get("drive") === "ok") setNotice("Google Drive conectado.");
    else setError(`Não foi possível conectar o Google Drive: ${q.get("msg") ?? ""}`);
    refreshIntegrations();
    window.history.replaceState(null, "", "#/demandas");
    setHash("#/demandas");
  }, [hash]);

  // o quadro acompanha os webhooks do War enquanto está aberto
  useEffect(() => {
    if (route.view !== "demandas" || selected) return;
    const t = window.setInterval(refreshBoard, 20_000);
    return () => window.clearInterval(t);
  }, [route.view, selected]);

  /** Sobe os brutos e abre o editor; a análise (transcrição, cortes, motions) já roda no servidor */
  const openCreated = async (create: () => Promise<Recipe>) => {
    setError(null);
    setStatus("Enviando clipes");
    try {
      const recipe = await create();
      refresh();
      refreshBoard();
      setSelected(recipe.projectId);
    } finally {
      setStatus(null);
    }
  };

  /** Igual, com o erro no aviso do topo */
  const launch = async (create: () => Promise<Recipe>) => {
    try {
      await openCreated(create);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const createDemand = async () => {
    if (clips.length === 0) return;
    const brief = briefing.trim();
    const ok = await launch(() => uploadProject(clips.map((c) => c.file), brief));
    if (ok) {
      setClips([]);
      setBriefing("");
    }
  };

  const moveDemand = async (id: string, next: string) => {
    // otimista: o cartão já muda de coluna; o servidor devolve ao War
    setBoard((b) => b && { ...b, demands: b.demands.map((d) => (d.id === id ? { ...d, status: next } : d)) });
    try {
      const d = await setDemandStatus(id, next);
      if (d.syncState === "error") setError(`O War não confirmou a mudança: ${d.syncError}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    refreshBoard();
  };

  if (route.view === "lab") {
    return <MotionLabPage onBack={() => go("#/demandas")} />;
  }

  if (selected) {
    return (
      <Editor
        key={`${selected}:${reloadKey}`}
        projectId={selected}
        projects={projects ?? []}
        backgroundStatus={status}
        onOpenProject={(id) => {
          refresh();
          setSelected(id);
        }}
        onHome={() => {
          refresh();
          refreshBoard();
          setSelected(null);
        }}
      />
    );
  }

  const drive = integrations?.drive;

  return (
    <div className="home">
      <header className="topbar">
        <span className="brand">
          <Logo />
        </span>
        <span className="topbar-sep" />
        <nav className="home-nav">
          <a className={route.view === "demandas" ? "on" : ""} href="#/demandas">
            <Icon name="board" size={14} />
            Demandas
          </a>
          <a className={route.view === "clientes" ? "on" : ""} href="#/clientes">
            <Icon name="user" size={14} />
            Clientes
          </a>
          <a className={route.view === "projetos" ? "on" : ""} href="#/projetos">
            <Icon name="film" size={14} />
            Projetos
          </a>
          {(me?.role === "superadmin" || me?.role === "admin") && (
            <a className={route.view === "usuarios" ? "on" : ""} href="#/usuarios">
              <Icon name="user" size={14} />
              Usuários
            </a>
          )}
        </nav>
        <span className="home-nav-spacer" />
        {integrations?.storage === "local" && (
          <span
            className="env-badge"
            title="Sem VISION_DATABASE_URL: demandas em data/demands-db.json"
          >
            dados locais
          </span>
        )}
        {drive &&
          (drive.connected ? (
            <ConfirmButton
              className="sm ghost drive-status on"
              title="Google Drive conectado · clique para desconectar"
              question="Desconectar o Drive?"
              onConfirm={async () => {
                await disconnectDrive();
                refreshIntegrations();
              }}
            >
              <Icon name="cloud" size={14} />
              {drive.email ?? "Drive conectado"}
            </ConfirmButton>
          ) : drive.configured ? (
            <a className="drive-status" href="/api/google/connect">
              <Icon name="cloud" size={14} />
              Conectar Google Drive
            </a>
          ) : (
            <span className="drive-status off" title="Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env">
              <Icon name="cloud" size={14} />
              Drive não configurado
            </span>
          ))}
        <NotificationBell onOpenDemand={(id) => go(`#/demandas/${encodeURIComponent(id)}`)} />
        <UserMenu onLogout={onLogout} />
        <a className="lab-link" href="#lab">
          Laboratório de motions
        </a>
      </header>
      {(error || notice) && (
        <div className={`banner ${error ? "" : "ok"}`}>
          {error ?? notice}
          <button
            className="sm ghost"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
          >
            Fechar
          </button>
        </div>
      )}

      {route.view === "demandas" && (
        <>
          {board ? (
            <DemandsBoard
              statuses={board.statuses}
              demands={board.demands}
              onOpen={(id) => go(`#/demandas/${encodeURIComponent(id)}`)}
              onMove={moveDemand}
            />
          ) : (
            <div className="page-pad">Carregando…</div>
          )}
          {route.id && (
            <DemandDetail
              demandId={route.id}
              statuses={board?.statuses ?? []}
              busy={status}
              onClose={() => go("#/demandas")}
              onChanged={refreshBoard}
              onOpenClient={(id) => go(`#/clientes/${encodeURIComponent(id)}`)}
              onOpenProject={(id) => setSelected(id)}
              onStartVideo={(demand, index, files, briefing) =>
                openCreated(() => uploadDemandVideo(demand.id, index, files, briefing))
              }
            />
          )}
        </>
      )}

      {route.view === "usuarios" && (
        <div className="home-scroll">
          <UsersPage />
        </div>
      )}

      {route.view === "clientes" && (
        <div className="home-scroll">
          <ClientsPage
            clientId={route.id}
            onOpenClient={(id) => go(id ? `#/clientes/${encodeURIComponent(id)}` : "#/clientes")}
            onOpenDemand={(id) => go(`#/demandas/${encodeURIComponent(id)}`)}
          />
        </div>
      )}

      {route.view === "projetos" && (
      <div className="home-body">
        <section>
          <h2>Projeto avulso</h2>
          <p className="lede">
            Fora do fluxo do War. Suba os clipes brutos: a IA já transcreve e sugere cortes e motions (com o briefing, se houver).
          </p>
          <div className="demand-form">
            <ClipDropzone
              count={clips.length}
              disabled={status !== null}
              onFiles={(files) => setClips((queue) => appendClips(queue, files))}
            />
            {clips.length > 0 && (
              <ClipQueue clips={clips} onChange={setClips} disabled={status !== null} />
            )}
            <label>
              Briefing do gestor (opcional)
              <textarea
                rows={4}
                placeholder="Ex.: cortar pausas, legendar, tratar o áudio e colocar música de fundo"
                value={briefing}
                onChange={(e) => setBriefing(e.target.value)}
              />
            </label>
            <button
              className="primary btn-block"
              disabled={clips.length === 0 || status !== null}
              onClick={createDemand}
            >
              {status
                ? `${status}…`
                : clips.length > 1
                  ? `Criar projeto com ${clips.length} clipes`
                  : "Criar projeto"}
            </button>
          </div>
        </section>

        <section>
          <h2>Projetos</h2>
          <p className="lede">
            {projects === null ? "Carregando…" : `${projects.length} no total, mais recentes primeiro.`}
          </p>
          {projects === null ? null : projects.length === 0 ? (
            <p className="empty-hint">
              Nenhum projeto ainda. <strong>Crie o primeiro</strong> subindo os clipes ao lado.
            </p>
          ) : (
            <div className="project-grid">
              {[...projects]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((p) => (
                  <ProjectCard key={p.id} project={p} onOpen={() => setSelected(p.id)} />
                ))}
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  );
};

export const App: React.FC = () => {
  // undefined = conferindo a sessão; null = precisa entrar
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null));
    const onUnauthorized = () => setUser(null);
    window.addEventListener("vision:unauthorized", onUnauthorized);
    return () => window.removeEventListener("vision:unauthorized", onUnauthorized);
  }, []);

  if (user === undefined) return null;
  if (user === null) return <LoginPage onLogin={setUser} />;
  return (
    <UserContext.Provider value={user}>
      <Workspace onLogout={() => setUser(null)} />
    </UserContext.Provider>
  );
};

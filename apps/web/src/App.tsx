import React, { useEffect, useRef, useState } from "react";
import {
  getDirectorJob,
  listProjects,
  startDirect,
  uploadProject,
  type ProjectSummary,
} from "./api";
import { Editor } from "./editor/Editor";
import { Icon } from "./editor/Icon";
import { MotionLabPage } from "./lab/MotionLabPage";
import { Logo } from "./ui/Logo";
import { appendClips, ClipQueue, type QueuedClip } from "./home/ClipQueue";

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

export const App: React.FC = () => {
  // null = ainda carregando
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // ordem da fila = ordem dos clipes na timeline
  const [clips, setClips] = useState<QueuedClip[]>([]);
  const [briefing, setBriefing] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // muda a cada demanda concluída para forçar o editor a recarregar
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = () => {
    listProjects().then(setProjects).catch((e) => setError(e.message));
  };
  useEffect(refresh, []);

  // #lab abre o laboratório de motions
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const createDemand = async () => {
    if (clips.length === 0) return;
    setError(null);
    setStatus("Enviando clipes");
    try {
      const recipe = await uploadProject(
        clips.map((c) => c.file),
        briefing.trim()
      );
      refresh();
      setSelected(recipe.projectId);
      setClips([]);
      if (fileRef.current) fileRef.current.value = "";
      if (briefing.trim()) {
        const job = await startDirect(recipe.projectId, briefing.trim());
        setStatus("Diretor IA: iniciando");
        const poll = window.setInterval(async () => {
          try {
            const j = await getDirectorJob(job.id);
            if (j.status === "running") {
              setStatus(`Diretor IA: ${j.stage}`);
            } else {
              window.clearInterval(poll);
              setStatus(null);
              if (j.status === "error") setError(`Diretor IA falhou: ${j.error}`);
              setReloadKey((k) => k + 1);
            }
          } catch {
            // erro transitório; tenta no próximo tick
          }
        }, 1500);
      } else {
        setStatus(null);
      }
      setBriefing("");
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (hash === "#lab") {
    return <MotionLabPage onBack={() => (window.location.hash = "")} />;
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
          setSelected(null);
        }}
      />
    );
  }

  const pickFiles = (list: FileList | null) => {
    // copia já: o FileList do input é esvaziado logo depois
    const files = Array.from(list ?? []);
    setClips((queue) => appendClips(queue, files));
  };

  return (
    <div className="home">
      <header className="topbar">
        <span className="brand">
          <Logo />
        </span>
        <a className="lab-link" href="#lab">
          Laboratório de motions
        </a>
      </header>
      {error && (
        <div className="banner">
          {error}
          <button className="sm ghost" onClick={() => setError(null)}>
            Fechar
          </button>
        </div>
      )}
      <div className="home-body">
        <section>
          <h2>Nova demanda</h2>
          <p className="lede">
            Suba os clipes brutos. Com briefing, o diretor IA já monta a primeira versão.
          </p>
          <div className="demand-form">
            <label
              className={`dropzone ${dragOver ? "over" : ""}`}
              onDragOver={(e) => {
                // só arquivos: reordenar a fila de clipes não acende a área
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFiles(e.dataTransfer.files);
              }}
            >
              <span className="dz-icon">
                <Icon name="upload" size={20} />
              </span>
              {clips.length > 0 ? (
                <>
                  <strong>Adicionar mais clipes</strong>
                  <span>arraste aqui ou clique · entram no fim da fila</span>
                </>
              ) : (
                <>
                  <strong>Arraste os vídeos aqui</strong>
                  <span>ou clique para escolher · vários clipes viram uma sequência</span>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                multiple
                onChange={(e) => {
                  pickFiles(e.target.files);
                  // permite escolher o mesmo arquivo de novo depois de tirá-lo
                  e.target.value = "";
                }}
              />
            </label>
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
    </div>
  );
};

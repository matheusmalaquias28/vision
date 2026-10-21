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

export const App: React.FC = () => {
  // null = ainda carregando
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
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

  const createDemand = async () => {
    if (files.length === 0) return;
    setError(null);
    setStatus("Enviando clipes");
    try {
      const recipe = await uploadProject(files, briefing.trim());
      refresh();
      setSelected(recipe.projectId);
      setFiles([]);
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

  const pickFiles = (list: FileList | null) =>
    setFiles(Array.from(list ?? []).filter((f) => f.type.startsWith("video")));

  return (
    <div className="home">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" />
          VISION
        </span>
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
              {files.length > 0 ? (
                <>
                  <strong>{files.length} clipe(s) prontos</strong>
                  <span className="file-chips">
                    {files.map((f) => (
                      <span key={f.name} title={f.name}>
                        {f.name}
                      </span>
                    ))}
                  </span>
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
                onChange={(e) => pickFiles(e.target.files)}
              />
            </label>
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
              disabled={files.length === 0 || status !== null}
              onClick={createDemand}
            >
              {status ? `${status}…` : "Criar projeto"}
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
            <div className="project-table">
              <div className="project-table-head">
                <span>Nome</span>
                <span>Clipes</span>
                <span>Bruto</span>
                <span>Criado</span>
              </div>
              {[...projects]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((p) => (
                  <button key={p.id} className="project-row" onClick={() => setSelected(p.id)}>
                    <span className="pr-name">
                      <span className="pr-thumb">
                        <Icon name="film" size={14} />
                      </span>
                      {p.id}
                    </span>
                    <span className="pr-num">{p.clipCount}</span>
                    <span className="pr-num">{fmtDuration(p.durationInSeconds)}</span>
                    <span className="pr-num">{fmtDate(p.createdAt)}</span>
                  </button>
                ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

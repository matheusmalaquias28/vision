import React, { useEffect, useRef, useState } from "react";
import {
  getDirectorJob,
  listProjects,
  startDirect,
  uploadProject,
  type ProjectSummary,
} from "./api";
import { Editor } from "./editor/Editor";

export const App: React.FC = () => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [briefing, setBriefing] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    setStatus("Enviando arquivos...");
    try {
      const recipe = await uploadProject(files, briefing.trim());
      refresh();
      setSelected(recipe.projectId);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      if (briefing.trim()) {
        const job = await startDirect(recipe.projectId, briefing.trim());
        setStatus("Diretor IA: iniciando...");
        const poll = window.setInterval(async () => {
          try {
            const j = await getDirectorJob(job.id);
            if (j.status === "running") {
              setStatus(`Diretor IA: ${j.stage}`);
            } else {
              window.clearInterval(poll);
              setStatus(null);
              if (j.status === "error") {
                setError(`Diretor IA falhou: ${j.error}`);
              }
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

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>VISION</h1>
        <div className="demand-form">
          <label className="upload-btn">
            {files.length > 0
              ? `${files.length} clipe(s) selecionado(s)`
              : "Selecionar clipes"}
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <textarea
            placeholder="Briefing do gestor (opcional). Ex: agrupar vídeos, cortar, legendar, melhorar o áudio e adicionar música de fundo"
            value={briefing}
            onChange={(e) => setBriefing(e.target.value)}
            rows={4}
          />
          <button
            className="primary"
            disabled={files.length === 0 || status !== null}
            onClick={createDemand}
          >
            {status ?? "Criar demanda"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                className={selected === p.id ? "active" : ""}
                onClick={() => setSelected(p.id)}
              >
                {p.id}
                <span className="muted">
                  {" "}
                  {p.clipCount > 1 ? `${p.clipCount} clipes · ` : ""}
                  {p.durationInSeconds.toFixed(0)}s
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="main">
        {selected ? (
          <Editor key={`${selected}:${reloadKey}`} projectId={selected} />
        ) : (
          <div className="empty">Crie uma demanda ou selecione um projeto</div>
        )}
      </main>
    </div>
  );
};

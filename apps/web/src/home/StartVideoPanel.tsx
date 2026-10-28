import React, { useEffect, useState } from "react";
import { formatBytes, formatSeconds, UPLOAD_LIMITS } from "@vision/recipe";
import { Icon } from "../editor/Icon";
import { inspectMediaFile } from "../editor/mediaFiles";
import { appendClips, ClipDropzone, ClipQueue, type QueuedClip } from "./ClipQueue";

interface StartVideoPanelProps {
  index: number;
  /** briefing como veio do War */
  warBriefing: string;
  /** brutos soltos na linha do vídeo antes de o painel abrir */
  initialFiles: File[];
  /** enviando (status do App) */
  busy: string | null;
  onCancel: () => void;
  /** sobe os brutos na ordem da fila; erro volta para o painel */
  onStart: (files: File[], briefing: string) => Promise<void>;
}

const LIMIT_HINT = `até ${formatSeconds(UPLOAD_LIMITS.video.maxSeconds)} e ${formatBytes(UPLOAD_LIMITS.video.maxBytes)} por clipe`;

/**
 * "Começar edição" de um vídeo da demanda: brutos (mesma fila ordenável dos
 * Projetos), briefing do War editável e o envio que cria o projeto e dispara
 * a análise automática. O briefing editado vale só para este projeto.
 */
export const StartVideoPanel: React.FC<StartVideoPanelProps> = ({
  index,
  warBriefing,
  initialFiles,
  busy,
  onCancel,
  onStart,
}) => {
  const [clips, setClips] = useState<QueuedClip[]>([]);
  const [briefing, setBriefing] = useState(warBriefing);
  const [checking, setChecking] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Mesmos limites do editor (UPLOAD_LIMITS); o servidor confere de novo */
  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setChecking(true);
    const results = await Promise.all(files.map(inspectMediaFile));
    setChecking(false);
    const ok: File[] = [];
    const problems: string[] = [];
    results.forEach((r, i) => {
      if ("error" in r) problems.push(r.error);
      else if (r.kind !== "video") problems.push(`${files[i].name}: só vídeo entra como bruto`);
      else ok.push(files[i]);
    });
    setRejected(problems);
    setClips((queue) => appendClips(queue, ok));
  };

  useEffect(() => {
    // a fila ignora repetidos: rodar duas vezes (StrictMode) não duplica
    addFiles(initialFiles);
  }, []);

  const start = async () => {
    setError(null);
    try {
      await onStart(clips.map((c) => c.file), briefing.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const locked = busy !== null;
  const edited = briefing.trim() !== warBriefing.trim();

  return (
    <li className="dd-start" aria-label={`Começar edição do vídeo ${index}`}>
      <div className="dd-start-step">
        <span className="dd-start-label">
          Clipes brutos <span className="dd-sub">{LIMIT_HINT}</span>
        </span>
        <ClipDropzone compact count={clips.length} disabled={locked} onFiles={addFiles} />
        {checking && <span className="dd-hint">conferindo os arquivos…</span>}
        {rejected.length > 0 && (
          <ul className="dd-start-rejected">
            {rejected.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {clips.length > 0 && <ClipQueue clips={clips} onChange={setClips} disabled={locked} />}
      </div>

      <div className="dd-start-step">
        <span className="dd-start-label">
          Briefing
          {edited && (
            <button
              type="button"
              className="sm ghost"
              disabled={locked}
              onClick={() => setBriefing(warBriefing)}
            >
              <Icon name="refresh" size={12} />
              Voltar ao do War
            </button>
          )}
        </span>
        <textarea
          aria-label="Briefing"
          rows={5}
          value={briefing}
          disabled={locked}
          placeholder="Sem briefing no War. Ex.: legendar, ritmo acelerado, sem música"
          onChange={(e) => setBriefing(e.target.value)}
        />
        <span className="dd-hint">
          A IA segue este texto. A mudança vale só para este vídeo no Vision; o War não é alterado.
        </span>
      </div>

      {error && <p className="dd-start-error">{error}</p>}

      <div className="dd-start-actions">
        <button className="sm ghost" disabled={locked} onClick={onCancel}>
          Cancelar
        </button>
        <button className="sm primary" disabled={clips.length === 0 || checking || locked} onClick={start}>
          <Icon name="upload" size={13} />
          {busy
            ? `${busy}…`
            : clips.length > 1
              ? `Começar edição com ${clips.length} clipes`
              : "Começar edição"}
        </button>
      </div>
    </li>
  );
};

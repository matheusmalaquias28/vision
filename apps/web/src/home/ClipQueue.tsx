import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../editor/Icon";

/** Clipe escolhido para a demanda, ainda no navegador (antes do upload) */
export interface QueuedClip {
  key: string;
  file: File;
}

/** Mesmo arquivo escolhido duas vezes não entra repetido */
export function clipKey(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

/** Junta os arquivos novos no fim da fila, sem repetir os que já estão */
export function appendClips(queue: QueuedClip[], files: File[]): QueuedClip[] {
  const taken = new Set(queue.map((c) => c.key));
  const added: QueuedClip[] = [];
  for (const file of files) {
    const key = clipKey(file);
    if (!file.type.startsWith("video") || taken.has(key)) continue;
    taken.add(key);
    added.push({ key, file });
  }
  return [...queue, ...added];
}

// tipo próprio no arrasto: a área de soltar arquivos ignora reordenações
const ROW_DRAG_TYPE = "application/x-vision-clip-row";

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s - m * 60)).padStart(2, "0")}`;
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

/** Primeiro quadro e duração do arquivo local, para o operador reconhecer o clipe */
const ClipThumb: React.FC<{ file: File; onDuration: (s: number) => void }> = ({ file, onDuration }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!url) return <span className="cq-thumb" />;
  return (
    <span className="cq-thumb">
      {/* #t=0.1: o quadro 0 costuma ser preto */}
      <video
        src={`${url}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => onDuration(e.currentTarget.duration)}
      />
    </span>
  );
};

interface ClipQueueProps {
  clips: QueuedClip[];
  onChange: (clips: QueuedClip[]) => void;
  disabled?: boolean;
}

/**
 * Fila dos clipes da demanda: a ordem daqui vira a ordem na timeline.
 * Arrastar a linha, ▲▼ ou "Ordenar por nome" reorganizam.
 */
export const ClipQueue: React.FC<ClipQueueProps> = ({ clips, onChange, disabled }) => {
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);
  /** Posição onde a linha arrastada entraria (0..clips.length) */
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to > clips.length || from === to || from + 1 === to) return;
    const next = [...clips];
    const [item] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, item);
    onChange(next);
  };

  const sortByName = () =>
    onChange(
      [...clips].sort((a, b) =>
        a.file.name.localeCompare(b.file.name, "pt-BR", { numeric: true, sensitivity: "base" })
      )
    );

  const total = clips.reduce((acc, c) => acc + (durations[c.key] ?? 0), 0);
  const allKnown = clips.every((c) => durations[c.key] !== undefined);

  return (
    <div className="clip-queue">
      <div className="cq-head">
        <span>
          <strong>{clips.length}</strong> {clips.length === 1 ? "clipe" : "clipes"}
          {allKnown && total > 0 ? ` · ${fmtDuration(total)} no total` : ""}
          {clips.length > 1 && <span className="cq-hint"> · arraste para mudar a ordem</span>}
        </span>
        {clips.length > 1 && (
          <button className="sm ghost" disabled={disabled} onClick={sortByName} title="Ordem natural: clipe 2 vem antes de clipe 10">
            Ordenar por nome
          </button>
        )}
      </div>
      <ol
        className="cq-list"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ROW_DRAG_TYPE)) return;
          e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(ROW_DRAG_TYPE)) return;
          e.preventDefault();
          const from = clips.findIndex((c) => c.key === dragKey);
          if (from >= 0 && dropIndex !== null) move(from, dropIndex);
          setDragKey(null);
          setDropIndex(null);
        }}
      >
        {clips.map((c, i) => (
          <li
            key={c.key}
            className={`cq-row ${dragKey === c.key ? "dragging" : ""} ${dropIndex === i ? "drop-before" : ""} ${dropIndex === clips.length && i === clips.length - 1 ? "drop-after" : ""}`}
            draggable={!disabled && clips.length > 1}
            onDragStart={(e) => {
              e.dataTransfer.setData(ROW_DRAG_TYPE, c.key);
              e.dataTransfer.effectAllowed = "move";
              setDragKey(c.key);
            }}
            onDragEnd={() => {
              setDragKey(null);
              setDropIndex(null);
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(ROW_DRAG_TYPE)) return;
              const r = e.currentTarget.getBoundingClientRect();
              setDropIndex(e.clientY < r.top + r.height / 2 ? i : i + 1);
            }}
          >
            <span className="cq-grip" aria-hidden>
              ⋮⋮
            </span>
            <span className="cq-num">{i + 1}</span>
            <ClipThumb file={c.file} onDuration={(s) => setDurations((d) => ({ ...d, [c.key]: s }))} />
            <span className="cq-info">
              <span className="cq-name" title={c.file.name}>
                {c.file.name}
              </span>
              <span className="cq-meta">
                {durations[c.key] !== undefined ? `${fmtDuration(durations[c.key])} · ` : ""}
                {fmtSize(c.file.size)}
              </span>
            </span>
            <span className="cq-actions">
              <button className="icon ghost sm" title="Subir" disabled={disabled || i === 0} onClick={() => move(i, i - 1)}>
                <Icon name="chevronUp" size={13} />
              </button>
              <button
                className="icon ghost sm"
                title="Descer"
                disabled={disabled || i === clips.length - 1}
                onClick={() => move(i, i + 2)}
              >
                <Icon name="chevronDown" size={13} />
              </button>
              <button
                className="icon ghost sm"
                title="Tirar da demanda"
                disabled={disabled}
                onClick={() => onChange(clips.filter((x) => x.key !== c.key))}
              >
                <Icon name="x" size={13} />
              </button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

interface ClipDropzoneProps {
  /** clipes já na fila: muda o texto para "adicionar mais" */
  count: number;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

/** Área de soltar/escolher os brutos; os arquivos entram no fim da fila */
export const ClipDropzone: React.FC<ClipDropzoneProps> = ({ count, onFiles, disabled, compact }) => {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <label
      className={`dropzone ${compact ? "compact" : ""} ${over ? "over" : ""} ${disabled ? "disabled" : ""}`}
      onDragOver={(e) => {
        // só arquivos: reordenar a fila de clipes não acende a área
        if (disabled || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <span className="dz-icon">
        <Icon name="upload" size={20} />
      </span>
      {count > 0 ? (
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
        ref={input}
        type="file"
        accept="video/*"
        multiple
        disabled={disabled}
        onChange={(e) => {
          // copia já: o FileList do input é esvaziado logo depois
          const files = Array.from(e.target.files ?? []);
          // permite escolher o mesmo arquivo de novo depois de tirá-lo
          e.target.value = "";
          onFiles(files);
        }}
      />
    </label>
  );
};

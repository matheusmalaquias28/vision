import React, { useMemo, useState } from "react";
import type { Demand } from "../api";
import { Icon } from "../editor/Icon";
import { Avatar, DueDate, PriorityBadge, StatusDot } from "./DemandBadges";
import { dueInfo, fmtDay, priorityTone, statusTone } from "./demandUtil";

interface DemandsBoardProps {
  statuses: string[];
  demands: Demand[];
  onOpen: (id: string) => void;
  onMove: (id: string, status: string) => void;
}

const DemandCard: React.FC<{ demand: Demand; onOpen: () => void }> = ({ demand: d, onOpen }) => {
  const done = statusTone(d.status) === "done";
  const analyzing = d.videos.some((v) => v.analysis?.status === "queued" || v.analysis?.status === "running");
  const progress = d.videoCount > 0 ? d.delivered / d.videoCount : 0;
  return (
    <button
      className={`dm-card st-${statusTone(d.status)}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-vision-demand", d.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
    >
      <span className="dm-card-top">
        <Avatar name={d.clientName} size={20} className="square" />
        <span className="dm-client">{d.clientName}</span>
        <PriorityBadge priority={d.priority} compact />
      </span>
      <span className="dm-title">{d.title || "Sem título"}</span>
      <span className="dm-dates">
        <span className="dm-date-cell">
          <span className="dm-date-label">Entrega</span>
          <DueDate dueDate={d.dueDate} done={done} />
        </span>
        <span className="dm-date-cell">
          <span className="dm-date-label">Criada</span>
          <span className="dm-created">
            <Icon name="clock" size={13} />
            {fmtDay(d.warCreatedAt ?? d.createdAt)}
          </span>
        </span>
      </span>
      <span className="dm-foot">
        <span
          className={`dm-videos ${d.videoCount > 0 && d.delivered === d.videoCount ? "done" : ""}`}
          title="Vídeos entregues no Drive"
        >
          <Icon name="film" size={12} />
          {d.delivered}/{d.videoCount}
          <span className="dm-progress">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        </span>
        {analyzing && (
          <span className="dm-analyzing" title="Transcrição, cortes e motions rodando no servidor">
            <Icon name="sparkles" size={12} />
            IA
          </span>
        )}
        {d.syncState === "error" && (
          <span className="dm-sync-err" title={d.syncError ?? "Status não chegou ao War"}>
            não sincronizado
          </span>
        )}
        {d.notas.some((n) => !n.apagadoEm) && (
          <span className="dm-notes" title="Comentários na conversa">
            <Icon name="chat" size={12} />
            {d.notas.filter((n) => !n.apagadoEm).length}
          </span>
        )}
        {d.editor && (
          <span className="dm-editor" title={`Editor: ${d.editor}`}>
            <Avatar name={d.editor} size={20} />
          </span>
        )}
      </span>
    </button>
  );
};

export const DemandsBoard: React.FC<DemandsBoardProps> = ({ statuses, demands, onOpen, onMove }) => {
  const [query, setQuery] = useState("");
  const [over, setOver] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return demands;
    return demands.filter((d) =>
      [d.clientName, d.title, d.editor, d.gestor].some((v) => v?.toLowerCase().includes(q))
    );
  }, [demands, query]);

  // mais urgentes e mais antigas primeiro dentro de cada coluna
  const rank = { high: 0, mid: 1, low: 2 } as const;
  const sorted = [...filtered].sort(
    (a, b) =>
      (rank[priorityTone(a.priority) ?? "low"] - rank[priorityTone(b.priority) ?? "low"]) ||
      (a.warCreatedAt ?? a.createdAt).localeCompare(b.warCreatedAt ?? b.createdAt)
  );

  const open = demands.filter((d) => statusTone(d.status) !== "done");
  const late = open.filter((d) => dueInfo(d.dueDate)?.tone === "late").length;
  const today = open.filter((d) => dueInfo(d.dueDate)?.tone === "today").length;

  return (
    <div className="board">
      <div className="board-bar">
        <div className="board-title">
          <h2>Demandas</h2>
          <span className="board-summary">
            <span>
              <strong>{open.length}</strong> em aberto
            </span>
            {today > 0 && (
              <span className="sum-today">
                <strong>{today}</strong> entrega hoje
              </span>
            )}
            {late > 0 && (
              <span className="sum-late">
                <strong>{late}</strong> atrasada{late > 1 ? "s" : ""}
              </span>
            )}
          </span>
        </div>
        <label className="board-search">
          <Icon name="search" size={14} />
          <input
            placeholder="Buscar cliente, título, editor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {demands.length === 0 ? (
        <div className="board-empty">
          <Icon name="board" size={28} />
          <strong>Nenhuma demanda ainda</strong>
          <span>
            As demandas de vídeo chegam do War pelo webhook
            <code>/api/webhooks/war</code>.
          </span>
        </div>
      ) : (
        <div className="board-cols">
          {statuses.map((status) => {
            const items = sorted.filter((d) => d.status === status);
            return (
              <section
                key={status}
                className={`board-col st-${statusTone(status)} ${over === status ? "over" : ""}`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("text/x-vision-demand")) return;
                  e.preventDefault();
                  setOver(status);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData("text/x-vision-demand");
                  const d = demands.find((x) => x.id === id);
                  if (d && d.status !== status) onMove(id, status);
                }}
              >
                <header className="board-col-head">
                  <StatusDot status={status} />
                  <span className="board-col-name">{status}</span>
                  <span className="board-col-count">{items.length}</span>
                </header>
                <div className="board-col-body">
                  {items.map((d) => (
                    <DemandCard key={d.id} demand={d} onOpen={() => onOpen(d.id)} />
                  ))}
                  {items.length === 0 && <span className="board-col-empty">Solte uma demanda aqui</span>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

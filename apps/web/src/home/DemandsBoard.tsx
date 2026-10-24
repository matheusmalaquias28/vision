import React, { useMemo, useState } from "react";
import type { Demand } from "../api";
import { Icon } from "../editor/Icon";
import { fmtDay, priorityTone } from "./demandUtil";

interface DemandsBoardProps {
  statuses: string[];
  demands: Demand[];
  onOpen: (id: string) => void;
  onMove: (id: string, status: string) => void;
}

const DemandCard: React.FC<{ demand: Demand; onOpen: () => void }> = ({ demand: d, onOpen }) => {
  const tone = priorityTone(d.priority);
  return (
    <button
      className="dm-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-vision-demand", d.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
    >
      <span className="dm-card-top">
        <span className="dm-client">{d.clientName}</span>
        {d.priority && <span className={`prio prio-${tone}`}>{d.priority}</span>}
      </span>
      <span className="dm-title">{d.title || "Sem título"}</span>
      <span className="dm-meta">
        <span className={`dm-videos ${d.delivered === d.videoCount ? "done" : ""}`} title="Vídeos entregues no Drive">
          <Icon name="film" size={12} />
          {d.delivered}/{d.videoCount}
        </span>
        {d.dueDate && (
          <span title="Prazo">
            <Icon name="calendar" size={12} />
            {fmtDay(d.dueDate)}
          </span>
        )}
        {d.editor && (
          <span className="dm-editor" title="Editor selecionado no War">
            <Icon name="user" size={12} />
            {d.editor}
          </span>
        )}
        {d.syncState === "error" && (
          <span className="dm-sync-err" title={d.syncError ?? "Status não chegou ao War"}>
            não sincronizado
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

  return (
    <div className="board">
      <div className="board-bar">
        <h2>Demandas</h2>
        <span className="board-count">{demands.length}</span>
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
                className={`board-col ${over === status ? "over" : ""}`}
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
                  <span>{status}</span>
                  <span className="board-col-count">{items.length}</span>
                </header>
                <div className="board-col-body">
                  {items.map((d) => (
                    <DemandCard key={d.id} demand={d} onOpen={() => onOpen(d.id)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

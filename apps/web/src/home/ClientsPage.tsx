import React, { useEffect, useState } from "react";
import { getClient, listClients, type Client, type ClientStats, type Demand } from "../api";
import { Icon } from "../editor/Icon";
import { fmtDay, instagramLink, priorityTone, safeUrl } from "./demandUtil";

interface ClientsPageProps {
  clientId: string | null;
  onOpenClient: (id: string | null) => void;
  onOpenDemand: (id: string) => void;
}

const Stats: React.FC<{ stats: ClientStats }> = ({ stats }) => (
  <dl className="cl-stats">
    <div>
      <dt>Demandas no mês</dt>
      <dd>{stats.month}</dd>
    </div>
    <div>
      <dt>Total de demandas</dt>
      <dd>{stats.total}</dd>
    </div>
    <div>
      <dt>Em aberto</dt>
      <dd>{stats.open}</dd>
    </div>
    <div>
      <dt>Vídeos pedidos</dt>
      <dd>{stats.videos}</dd>
    </div>
  </dl>
);

const ClientFile: React.FC<{ id: string; onBack: () => void; onOpenDemand: (id: string) => void }> = ({
  id,
  onBack,
  onOpenDemand,
}) => {
  const [data, setData] = useState<{ client: Client; stats: ClientStats; demands: Demand[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getClient(id).then(setData).catch((e: Error) => setError(e.message));
  }, [id]);

  if (!data) return <div className="page-pad">{error ?? "Carregando…"}</div>;
  const { client, stats, demands } = data;
  const insta = instagramLink(client.instagram);
  const drive = safeUrl(client.drive);

  return (
    <div className="page-pad cl-file">
      <button className="sm ghost" onClick={onBack}>
        <Icon name="chevronLeft" size={13} />
        Clientes
      </button>
      <header className="cl-head">
        <h2>{client.name}</h2>
        <div className="cl-links">
          {insta && (
            <a href={insta.url} target="_blank" rel="noreferrer noopener">
              {insta.handle}
              <Icon name="external" size={12} />
            </a>
          )}
          {drive && (
            <a href={drive} target="_blank" rel="noreferrer noopener">
              <Icon name="folder" size={13} />
              Drive do cliente
              <Icon name="external" size={12} />
            </a>
          )}
          {client.gestor && <span>Gestor: {client.gestor}</span>}
          {client.squad && <span>Squad: {client.squad}</span>}
          {!client.warClientId && (
            <span className="cl-warn" title="O War não achou esse nome no cadastro de clientes">
              sem cadastro no War
            </span>
          )}
        </div>
      </header>
      <Stats stats={stats} />
      <h3 className="cl-h3">Demandas</h3>
      <table className="cl-table">
        <thead>
          <tr>
            <th>Título</th>
            <th>Status</th>
            <th>Prioridade</th>
            <th>Vídeos</th>
            <th>Criada</th>
          </tr>
        </thead>
        <tbody>
          {demands.map((d) => (
            <tr key={d.id} onClick={() => onOpenDemand(d.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpenDemand(d.id)}>
              <td className="cl-strong">{d.title || "Sem título"}</td>
              <td>{d.status}</td>
              <td>{d.priority && <span className={`prio prio-${priorityTone(d.priority)}`}>{d.priority}</span>}</td>
              <td>
                {d.delivered}/{d.videoCount}
              </td>
              <td>{fmtDay(d.warCreatedAt ?? d.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const ClientsPage: React.FC<ClientsPageProps> = ({ clientId, onOpenClient, onOpenDemand }) => {
  const [clients, setClients] = useState<(Client & { stats: ClientStats })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) listClients().then(setClients).catch((e: Error) => setError(e.message));
  }, [clientId]);

  if (clientId) {
    return <ClientFile id={clientId} onBack={() => onOpenClient(null)} onOpenDemand={onOpenDemand} />;
  }
  return (
    <div className="page-pad">
      <div className="board-bar">
        <h2>Clientes</h2>
        {clients && <span className="board-count">{clients.length}</span>}
      </div>
      {error && <p className="note error">{error}</p>}
      {clients && clients.length === 0 && (
        <p className="empty-hint">Os clientes aparecem aqui quando a primeira demanda deles chega do War.</p>
      )}
      {clients && clients.length > 0 && (
        <table className="cl-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Instagram</th>
              <th>No mês</th>
              <th>Total</th>
              <th>Em aberto</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} onClick={() => onOpenClient(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpenClient(c.id)}>
                <td className="cl-strong">{c.name}</td>
                <td>{instagramLink(c.instagram)?.handle ?? "—"}</td>
                <td>{c.stats.month}</td>
                <td>{c.stats.total}</td>
                <td>{c.stats.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

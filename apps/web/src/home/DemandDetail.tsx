import React, { useEffect, useState } from "react";
import {
  getDemand,
  markNotificationsRead,
  resyncDemand,
  setDemandStatus,
  type Client,
  type Demand,
  type DemandEvent,
  type DemandVideo,
} from "../api";
import { Icon } from "../editor/Icon";
import { Select } from "../ui/controls";
import { DemandNotes } from "./DemandNotes";
import { StartVideoPanel } from "./StartVideoPanel";
import { Avatar, DueDate, PriorityBadge, StatusDot } from "./DemandBadges";
import { fmtDateTime, instagramLink, safeUrl, statusTone } from "./demandUtil";

interface DemandDetailProps {
  demandId: string;
  statuses: string[];
  /** busy = criando projeto/subindo brutos fora daqui */
  busy: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenClient: (id: string) => void;
  onOpenProject: (projectId: string) => void;
  /** cria o projeto do vídeo com os brutos (na ordem) e o briefing editado; erro volta ao painel */
  onStartVideo: (demand: Demand, index: number, files: File[], briefing: string) => Promise<void>;
}

const ExtLink: React.FC<{ href: string | null; children: React.ReactNode; className?: string }> = ({
  href,
  children,
  className,
}) => {
  const url = safeUrl(href);
  if (!url) return <span className="dd-missing">{href || "—"}</span>;
  return (
    <a className={className} href={url} target="_blank" rel="noreferrer noopener">
      {children}
      <Icon name="external" size={12} />
    </a>
  );
};

const VideoRow: React.FC<{
  video: DemandVideo;
  disabled: boolean;
  /** painel de começar aberto logo abaixo */
  starting: boolean;
  onOpen: () => void;
  /** abre o painel de começar (com os brutos soltos na linha, se houver) */
  onStart: (files: File[]) => void;
}> = ({ video, disabled, starting, onOpen, onStart }) => {
  const [over, setOver] = useState(false);
  const a = video.analysis;
  const analyzing = a?.status === "queued" || a?.status === "running";
  const state = video.deliveredAt
    ? "Entregue"
    : analyzing
      ? "IA analisando"
      : video.projectId
        ? "Em edição"
        : "Não iniciado";
  // com o painel aberto, os brutos vão para a área dele
  const takesFiles = !video.projectId && !starting && !disabled;
  return (
    <li
      className={`dd-video ${over ? "over" : ""} ${starting ? "starting" : ""}`}
      onDragOver={(e) => {
        if (!takesFiles || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!takesFiles) return;
        e.preventDefault();
        setOver(false);
        onStart(Array.from(e.dataTransfer.files));
      }}
    >
      <span className="dd-video-num">{String(video.index).padStart(2, "0")}</span>
      <span className="dd-video-info">
        <span className={`dd-video-state ${video.deliveredAt ? "ok" : video.projectId ? "doing" : ""}`}>
          {state}
        </span>
        {video.deliveredAt && video.driveFileUrl ? (
          <ExtLink href={video.driveFileUrl}>enviado {fmtDateTime(video.deliveredAt)}</ExtLink>
        ) : analyzing ? (
          <span className="dd-hint">{a!.stage}…</span>
        ) : a?.status === "error" && !video.deliveredAt ? (
          <span className="dd-hint err" title={a.error ?? ""}>análise falhou: rode Analisar no editor</span>
        ) : a?.status === "done" && !video.deliveredAt ? (
          <span className="dd-hint">sugestões da IA prontas para revisar</span>
        ) : (
          !video.projectId &&
          (starting ? (
            <span className="dd-hint">escolha os brutos e confira o briefing abaixo</span>
          ) : (
            <span className="dd-hint">arraste os brutos aqui ou clique em começar</span>
          ))
        )}
      </span>
      {video.projectId ? (
        <button className="sm" onClick={onOpen}>
          <Icon name="film" size={13} />
          Abrir edição
        </button>
      ) : (
        !starting && (
          <button className="sm primary" disabled={disabled} onClick={() => onStart([])}>
            <Icon name="upload" size={13} />
            Começar edição
          </button>
        )
      )}
    </li>
  );
};

function eventLabel(e: DemandEvent): string {
  if (e.kind === "created") return "Demanda recebida do War";
  if (e.kind === "updated") return "Demanda atualizada no War";
  if (e.kind === "note") return e.direction === "out" ? "Comentário enviado ao War" : "Comentário recebido do War";
  const move = e.previousStatus ? `${e.previousStatus} → ${e.status}` : (e.status ?? "");
  return e.direction === "out" ? `Vision → War: ${move}` : `War: ${move}`;
}

export const DemandDetail: React.FC<DemandDetailProps> = ({
  demandId,
  statuses,
  busy,
  onClose,
  onChanged,
  onOpenClient,
  onOpenProject,
  onStartVideo,
}) => {
  const [data, setData] = useState<{ demand: Demand; client: Client | null; events: DemandEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** vídeo com o painel de começar aberto (só um por vez) */
  const [starting, setStarting] = useState<{ index: number; files: File[] } | null>(null);

  const load = () =>
    getDemand(demandId)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
    // abrir a demanda dá como lidas as notificações dela
    markNotificationsRead(demandId)
      .then(() => window.dispatchEvent(new Event("vision:notifications")))
      .catch(() => {});
    // a conversa acompanha os comentários que chegam do War
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [demandId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc fecha primeiro o painel de começar (enviando, nada fecha)
      if (starting) {
        if (busy === null) setStarting(null);
      } else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, starting, busy]);

  const changeStatus = async (status: string, resync = false) => {
    setSaving(true);
    setError(null);
    try {
      const d = resync ? await resyncDemand(demandId) : await setDemandStatus(demandId, status);
      if (d.syncState === "error") setError(`O War não confirmou: ${d.syncError}`);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const d = data?.demand;
  const insta = instagramLink(d?.instagram ?? data?.client?.instagram ?? null);
  const columns = d && !statuses.includes(d.status) ? [...statuses, d.status] : statuses;

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dmodal ${d ? `st-${statusTone(d.status)}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Demanda"
      >
        {!d ? (
          <div className="dmodal-loading">{error ?? "Carregando…"}</div>
        ) : (
          <>
            <header className="dmodal-head">
              <div className="dmodal-head-main">
                <div className="dmodal-crumbs">
                  <Avatar name={d.clientName} size={22} className="square" />
                  <button className="dd-client-link" onClick={() => onOpenClient(d.clientId)}>
                    {d.clientName}
                    <Icon name="chevronRight" size={12} />
                  </button>
                  {d.categoria && <span className="dmodal-tag">{d.categoria}</span>}
                  {d.squad && <span className="dmodal-tag">{d.squad}</span>}
                </div>
                <h2>{d.title || "Sem título"}</h2>
              </div>
              <button className="icon ghost dmodal-close" title="Fechar (Esc)" onClick={onClose}>
                <Icon name="x" size={18} />
              </button>
            </header>

            <div className="dmodal-props">
              <div className="dm-prop">
                <span className="dm-prop-label">Status</span>
                <span className="status-select">
                  <StatusDot status={d.status} />
                  <Select
                    value={d.status}
                    disabled={saving}
                    onChange={(e) => changeStatus(e.target.value)}
                    aria-label="Status da demanda"
                  >
                    {columns.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </span>
              </div>
              <div className="dm-prop">
                <span className="dm-prop-label">Prioridade</span>
                {d.priority ? <PriorityBadge priority={d.priority} /> : <span className="dm-prop-value">—</span>}
              </div>
              <div className="dm-prop">
                <span className="dm-prop-label">Entrega</span>
                <DueDate dueDate={d.dueDate} done={statusTone(d.status) === "done"} size="lg" />
              </div>
              <div className="dm-prop">
                <span className="dm-prop-label">Criada</span>
                <span className="dm-prop-value">
                  <Icon name="clock" size={14} />
                  {fmtDateTime(d.warCreatedAt ?? d.createdAt)}
                </span>
              </div>
              <div className="dm-prop">
                <span className="dm-prop-label">Gestor</span>
                <span className="dm-prop-value">
                  {d.gestor ? (
                    <>
                      <Avatar name={d.gestor} size={20} />
                      {d.gestor}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <span className="dmodal-sync">
                {saving && <span className="dd-saving">enviando ao War…</span>}
                {!saving && d.syncState === "error" && (
                  <button className="sm danger" onClick={() => changeStatus(d.status, true)}>
                    <Icon name="refresh" size={13} />
                    Reenviar ao War
                  </button>
                )}
              </span>
            </div>
            {error && <p className="note error dmodal-error">{error}</p>}

            <div className="dmodal-body">
              <div className="dmodal-main">
                <a
                  className={`dd-materials ${safeUrl(d.driveMateriais) ? "" : "disabled"}`}
                  href={safeUrl(d.driveMateriais) ?? undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="dd-materials-icon">
                    <Icon name="folder" size={18} />
                  </span>
                  <span>
                    <strong>Drive de Materiais</strong>
                    <span>{safeUrl(d.driveMateriais) ? "Onde estão os vídeos brutos" : "Link não informado"}</span>
                  </span>
                  <Icon name="external" size={14} />
                </a>

                <section className="dd-section">
                  <h3>
                    Vídeos <span className="dd-sub">{d.delivered}/{d.videoCount} entregues</span>
                  </h3>
                  <ul className="dd-videos">
                    {d.videos.map((v) => {
                      const open = starting?.index === v.index && !v.projectId;
                      return (
                        <React.Fragment key={v.index}>
                          <VideoRow
                            video={v}
                            disabled={busy !== null}
                            starting={open}
                            onOpen={() => v.projectId && onOpenProject(v.projectId)}
                            onStart={(files) => setStarting({ index: v.index, files })}
                          />
                          {open && starting && (
                            <StartVideoPanel
                              index={v.index}
                              warBriefing={d.briefing || d.briefingText || ""}
                              initialFiles={starting.files}
                              busy={busy}
                              onCancel={() => setStarting(null)}
                              onStart={(files, briefing) => onStartVideo(d, v.index, files, briefing)}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </ul>
                  {busy && <p className="dd-busy">{busy}…</p>}
                </section>

                <section className="dd-section">
                  <h3>Briefing</h3>
                  <p className="dd-briefing">{d.briefing || d.briefingText || "Sem briefing."}</p>
                </section>

                <section className="dd-section">
                  <h3>Informações</h3>
                  <dl className="dd-fields">
                    <dt>Instagram</dt>
                    <dd>{insta ? <ExtLink href={insta.url}>{insta.handle}</ExtLink> : "—"}</dd>
                    <dt>Drive para editados</dt>
                    <dd>
                      <ExtLink href={d.driveEditados}>abrir pasta</ExtLink>
                    </dd>
                    <dt>Drive do cliente</dt>
                    <dd>
                      <ExtLink href={data?.client?.drive ?? null}>abrir pasta</ExtLink>
                    </dd>
                    <dt>Solicitante</dt>
                    <dd>{d.solicitante ?? "—"}</dd>
                    <dt>Editor (War)</dt>
                    <dd>{d.editor ?? "—"}</dd>
                    <dt>Squad</dt>
                    <dd>{d.squad ?? "—"}</dd>
                    <dt>Categoria</dt>
                    <dd>{d.categoria ?? "—"}</dd>
                  </dl>
                </section>

                <section className="dd-section">
                  <h3>Histórico</h3>
                  <ol className="dd-events">
                    {data.events.map((e) => (
                      <li key={e.id} className={e.ok ? "" : "fail"}>
                        <span>{eventLabel(e)}</span>
                        <span className="dd-event-meta">
                          {fmtDateTime(e.createdAt)}
                          {e.by ? ` · ${e.by}` : ""}
                          {!e.ok && e.error ? ` · ${e.error}` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>

              <DemandNotes
                demandId={d.id}
                notes={d.notas}
                people={[d.gestor, d.solicitante, d.editor]}
                onChanged={load}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

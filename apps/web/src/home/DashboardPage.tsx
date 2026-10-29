import React, { useCallback, useEffect, useState } from "react";
import { getDayReport, type AttentionKind, type DayItem, type DayReport } from "../api";
import { Icon, type IconName } from "../editor/Icon";
import { StatusDot } from "./DemandBadges";
import { statusTone } from "./demandUtil";

interface DashboardPageProps {
  onOpenDemand: (id: string) => void;
}

const ATTENTION_LABEL: Record<AttentionKind, string> = {
  overdue: "Atrasada",
  "due-today": "Entrega hoje",
  "due-soon-not-started": "Não começou",
  "no-date": "Sem data",
  stale: "Parada",
  "sync-error": "War",
  "analysis-error": "IA",
  unanswered: "Sem resposta",
};

/** "2026-10-29" ± dias */
function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

function fmtLongDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

const fmtHour = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtNum = (v: number | null, digits = 1) =>
  v === null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: digits });

const Kpi: React.FC<{
  icon: IconName;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "danger" | "ok" | "accent";
  hint?: string;
}> = ({ icon, label, value, sub, tone, hint }) => (
  <div className={`dash-kpi ${tone ? `tone-${tone}` : ""}`} title={hint}>
    <span className="dash-kpi-head">
      <span className="dash-kpi-icon">
        <Icon name={icon} size={15} />
      </span>
      {label}
    </span>
    <strong className="dash-kpi-value">{value}</strong>
    {sub && <span className="dash-kpi-sub">{sub}</span>}
  </div>
);

const ItemList: React.FC<{
  title: string;
  icon: IconName;
  items: DayItem[];
  empty: string;
  onOpenDemand: (id: string) => void;
}> = ({ title, icon, items, empty, onOpenDemand }) => (
  <section className="dash-card">
    <header className="dash-card-head">
      <Icon name={icon} size={15} />
      <h3>{title}</h3>
      <span className="dash-count">{items.length}</span>
    </header>
    {items.length === 0 ? (
      <p className="dash-empty">{empty}</p>
    ) : (
      <ul className="dash-list">
        {items.map((it, i) => (
          <li key={`${it.demandId}-${it.index}-${i}`}>
            <button
              className="dash-row"
              disabled={!it.demandId}
              onClick={() => it.demandId && onOpenDemand(it.demandId)}
            >
              <span className="dash-row-time">{fmtHour(it.at)}</span>
              <span className="dash-row-main">
                <strong>
                  {it.title}
                  {it.index !== null && <span className="dash-row-idx"> · vídeo {String(it.index).padStart(2, "0")}</span>}
                </strong>
                <span>{it.clientName}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);

/**
 * Resumo do dia (só superadmin): o que aconteceu no dia escolhido (novas,
 * edições começadas, entregas, status) e a situação de agora (abertas,
 * atrasadas, pontos de atenção). Médias de prazo: últimos 30 dias.
 */
export const DashboardPage: React.FC<DashboardPageProps> = ({ onOpenDemand }) => {
  const [day, setDay] = useState<string | null>(null);
  const [report, setReport] = useState<DayReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((d: string | null) => {
    setLoading(true);
    setError(null);
    getDayReport(d ?? undefined)
      .then((r) => {
        setReport(r);
        setDay(r.day);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(null), [load]);
  // o dia de hoje se atualiza sozinho a cada 2 min
  useEffect(() => {
    if (!report?.isToday) return;
    const t = window.setInterval(() => load(report.day), 120_000);
    return () => window.clearInterval(t);
  }, [report?.isToday, report?.day, load]);

  if (!report) {
    return <div className="dash">{error ? <p className="note error">{error}</p> : <p className="dash-empty">Carregando…</p>}</div>;
  }

  const k = report.kpis;
  const maxStatus = Math.max(1, ...report.statusBoard.map((s) => s.open));
  // a lista do War tem muitos status: só os que têm demanda ou movimento no dia
  const statusRows = report.statusBoard.filter((s) => s.open > 0 || s.enteredToday > 0);
  const hiddenStatus = report.statusBoard.length - statusRows.length;
  const high = report.attention.filter((a) => a.severity === "high").length;

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <h2>Resumo do dia</h2>
          <p className="dash-sub">
            {fmtLongDay(report.day)}
            {report.isToday && <span className="dash-live">ao vivo · atualizado {fmtHour(report.generatedAt)}</span>}
          </p>
        </div>
        <div className="dash-daynav">
          <button className="icon" title="Dia anterior" disabled={loading} onClick={() => day && load(shiftDay(day, -1))}>
            <Icon name="chevronLeft" size={15} />
          </button>
          <input
            type="date"
            value={day ?? ""}
            max={report.isToday ? report.day : undefined}
            onChange={(e) => e.target.value && load(e.target.value)}
          />
          <button
            className="icon"
            title="Dia seguinte"
            disabled={loading || report.isToday}
            onClick={() => day && load(shiftDay(day, 1))}
          >
            <Icon name="chevronRight" size={15} />
          </button>
          {!report.isToday && (
            <button onClick={() => load(null)} disabled={loading}>
              Hoje
            </button>
          )}
          <button className="icon" title="Atualizar" disabled={loading} onClick={() => load(day)}>
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </header>
      {error && <p className="note error">{error}</p>}

      <div className="dash-kpis">
        <Kpi
          icon="upload"
          label="Edições iniciadas"
          value={k.editsStarted}
          sub={k.editsStartedLoose > 0 ? `${k.editsStartedLoose} avulsa${k.editsStartedLoose > 1 ? "s" : ""}` : "todas de demandas"}
          tone="accent"
        />
        <Kpi
          icon="film"
          label="Vídeos entregues"
          value={k.videosDelivered}
          sub={`${k.demandsDelivered} demanda${k.demandsDelivered === 1 ? "" : "s"} completa${k.demandsDelivered === 1 ? "" : "s"}`}
          tone="ok"
          hint="Vídeos enviados ao Drive no dia"
        />
        <Kpi icon="check" label="Concluídas" value={k.demandsCompleted} sub="chegaram ao status final" />
        <Kpi icon="board" label="Novas demandas" value={k.newDemands} sub="criadas no War no dia" />
        <Kpi icon="clock" label="Em aberto" value={k.openDemands} sub="agora" />
        <Kpi
          icon="flag"
          label="Atrasadas"
          value={k.overdue}
          sub={k.overdue > 0 ? "prazo vencido, não entregues" : "nenhuma agora"}
          tone={k.overdue > 0 ? "danger" : undefined}
        />
      </div>

      <div className="dash-averages">
        <div className="dash-avg">
          <span className="dash-avg-label">Prazo médio de entrega</span>
          <strong>
            {fmtNum(k.avgLeadDays)}
            {k.avgLeadDays !== null && <small> dias</small>}
          </strong>
          <span className="dash-avg-hint">da criação no War ao último vídeo entregue</span>
        </div>
        <div className="dash-avg">
          <span className="dash-avg-label">Tempo médio de edição</span>
          <strong>
            {k.avgEditHours === null
              ? "—"
              : k.avgEditHours >= 48
                ? fmtNum(k.avgEditHours / 24)
                : fmtNum(k.avgEditHours)}
            {k.avgEditHours !== null && <small>{k.avgEditHours >= 48 ? " dias" : " h"}</small>}
          </strong>
          <span className="dash-avg-hint">do início da edição à entrega de cada vídeo</span>
        </div>
        <div className="dash-avg">
          <span className="dash-avg-label">Entregues no prazo</span>
          <strong>
            {k.onTimeRate === null ? "—" : Math.round(k.onTimeRate * 100)}
            <small>{k.onTimeRate === null ? "" : " %"}</small>
          </strong>
          {k.onTimeRate !== null && (
            <span className="dash-meter" aria-hidden="true">
              <span style={{ width: `${k.onTimeRate * 100}%` }} />
            </span>
          )}
          <span className="dash-avg-hint">das demandas com prazo</span>
        </div>
        <p className="dash-avg-note">
          Últimos 30 dias · {k.averageSample} demanda{k.averageSample === 1 ? "" : "s"} entregue
          {k.averageSample === 1 ? "" : "s"}
        </p>
      </div>

      <div className="dash-grid">
        <section className="dash-card dash-attention">
          <header className="dash-card-head">
            <Icon name="flag" size={15} />
            <h3>Pontos de atenção</h3>
            <span className={`dash-count ${high > 0 ? "danger" : ""}`}>{report.attention.length}</span>
            <span className="dash-card-meta">situação de agora</span>
          </header>
          {report.attention.length === 0 ? (
            <p className="dash-empty">Nada pedindo atenção agora.</p>
          ) : (
            <ul className="dash-list">
              {report.attention.map((a, i) => (
                <li key={`${a.demandId}-${a.kind}-${i}`}>
                  <button className="dash-row" onClick={() => onOpenDemand(a.demandId)}>
                    <span className={`dash-flag sev-${a.severity}`}>{ATTENTION_LABEL[a.kind]}</span>
                    <span className="dash-row-main">
                      <strong>{a.title}</strong>
                      <span>
                        {a.clientName} · {a.detail}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-card">
          <header className="dash-card-head">
            <Icon name="chart" size={15} />
            <h3>Demandas por status</h3>
            <span className="dash-card-meta">agora · entradas no dia</span>
          </header>
          <ul className="dash-status">
            {statusRows.map((s) => (
              <li
                key={s.status}
                title={`${s.status}: ${s.open} agora${s.enteredToday ? ` · ${s.enteredToday} entraram no dia` : ""}`}
              >
                <span className="dash-status-name">
                  <StatusDot status={s.status} />
                  {s.status}
                </span>
                <span className="dash-status-bar">
                  <span className={`st-fill st-${statusTone(s.status)} ${s.open === 0 ? "zero" : ""}`} style={{ width: `${(s.open / maxStatus) * 100}%` }} />
                </span>
                <span className="dash-status-num">{s.open}</span>
                <span className={`dash-status-in ${s.enteredToday ? "" : "none"}`}>
                  {s.enteredToday ? `+${s.enteredToday}` : "·"}
                </span>
              </li>
            ))}
          </ul>
          {statusRows.length === 0 && <p className="dash-empty">Nenhuma demanda.</p>}
          {hiddenStatus > 0 && (
            <p className="dash-foot">
              {hiddenStatus} status sem demandas agora nem movimento no dia
            </p>
          )}
        </section>

        <ItemList
          title="Entregues no dia"
          icon="film"
          items={report.delivered}
          empty="Nenhum vídeo entregue no dia."
          onOpenDemand={onOpenDemand}
        />
        <ItemList
          title="Edições iniciadas no dia"
          icon="upload"
          items={report.started}
          empty="Nenhuma edição começou no dia."
          onOpenDemand={onOpenDemand}
        />

        <section className="dash-card">
          <header className="dash-card-head">
            <Icon name="user" size={15} />
            <h3>Quem mexeu</h3>
            <span className="dash-card-meta">status e comentários pelo Vision</span>
          </header>
          {report.activity.length === 0 ? (
            <p className="dash-empty">Ninguém mudou status nem comentou pelo Vision no dia.</p>
          ) : (
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Status</th>
                  <th>Comentários</th>
                </tr>
              </thead>
              <tbody>
                {report.activity.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.statusMoves}</td>
                    <td>{p.comments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
};

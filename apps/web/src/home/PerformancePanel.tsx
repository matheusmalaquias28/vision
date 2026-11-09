import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getPerformance, type DailyPoint, type DemandTimeRow, type PerformanceReport } from "../api";
import { Icon, type IconName } from "../editor/Icon";

/**
 * Desempenho por período (Painel → Desempenho, só superadmin): tempo REAL de
 * edição (batimentos do editor), vídeos editados/renderizados/entregues,
 * médias, dias mais e menos produtivos, horários e o tempo de cada demanda
 * (pedido → data definida → entrega). Gráficos em SVG próprio.
 */

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const WEEKDAYS_LONG = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

type Preset = "7" | "30" | "90" | "month";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "7", label: "7 dias" },
  { id: "30", label: "30 dias" },
  { id: "90", label: "90 dias" },
  { id: "month", label: "Este mês" },
];

const localToday = () => new Date().toLocaleDateString("en-CA");
const shiftDay = (day: string, delta: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

function rangeFor(p: Preset): { from: string; to: string } {
  const to = localToday();
  if (p === "month") return { from: `${to.slice(0, 8)}01`, to };
  return { from: shiftDay(to, -(Number(p) - 1)), to };
}

// ─── formatos ────────────────────────────────────────────────────────

const fmtDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const fmtIsoDay = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const fmtIsoDayTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const weekdayOf = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
const fmtDayLong = (day: string) => `${WEEKDAYS_LONG[weekdayOf(day)]}, ${fmtDay(day)}`;
const num = (v: number, digits = 1) => v.toLocaleString("pt-BR", { maximumFractionDigits: digits });

/** 38h 20min · 45min · 0min */
function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, "0")}min` : `${h}h`;
}

/** Horas → "6 h" / "1 dia 4 h" / "3,5 dias" */
function fmtHoursSpan(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  if (hours < 48) return `${num(hours, hours < 10 ? 1 : 0)} h`;
  return `${num(hours / 24)} dias`;
}

const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

// ─── base dos gráficos ───────────────────────────────────────────────

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Escala "redonda": 0 e mais 3–4 marcas limpas */
function niceTicks(max: number, target = 4, integer = false): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  // contagens (vídeos): só marcas inteiras
  const step = integer ? Math.max(1, Math.round(nice)) : nice;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Barra com o topo arredondado (4px) e a base reta */
function barPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

interface Series {
  key: string;
  label: string;
  color: string;
}

interface ColumnItem {
  key: string;
  label: string;
  values: number[];
  /** sem medição: placeholder tracejado */
  untracked?: boolean;
  /** fundo destacado (fim de semana) */
  shaded?: boolean;
  /** cor apagada (semana em andamento, dias que não são o destaque) */
  muted?: boolean;
  /** rótulo de valor no topo */
  tag?: string;
}

const Tooltip: React.FC<{ x: number; y: number; width: number; children: React.ReactNode }> = ({ x, y, width, children }) => {
  const left = Math.max(8, Math.min(width - 208, x - 100));
  return (
    <div className="pf-tip" style={{ left, top: y }}>
      {children}
    </div>
  );
};

/**
 * Colunas (uma ou mais séries lado a lado), um eixo só. Passar o mouse em
 * qualquer ponto da faixa do dia mostra o detalhe.
 */
const ColumnChart: React.FC<{
  items: ColumnItem[];
  series: Series[];
  height?: number;
  tickFormat: (v: number) => string;
  tooltip: (index: number) => React.ReactNode;
  ariaLabel: string;
  minLabelGap?: number;
  integer?: boolean;
}> = ({ items, series, height = 200, tickFormat, tooltip, ariaLabel, minLabelGap = 44, integer = false }) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 40;
  const padR = 8;
  const padT = 18;
  const padB = 24;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const max = Math.max(0, ...items.flatMap((i) => i.values));
  const ticks = niceTicks(max, integer ? 3 : 4, integer);
  const top = ticks.at(-1)!;
  const band = items.length ? plotW / items.length : 0;
  const n = series.length;
  const barW = Math.max(2, Math.min(n > 1 ? 12 : 24, (band * 0.66 - (n - 1) * 2) / n));
  const groupW = barW * n + (n - 1) * 2;
  const labelEvery = Math.max(1, Math.ceil(minLabelGap / Math.max(1, band)));
  const y = (v: number) => padT + plotH - (v / top) * plotH;

  return (
    <div className="pf-chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <defs>
            <pattern id="pf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line-2)" strokeWidth="1.5" />
            </pattern>
          </defs>
          {items.map((it, i) =>
            it.shaded ? (
              <rect key={`s${it.key}`} x={padL + i * band} y={padT} width={band} height={plotH} fill="var(--pf-shade)" />
            ) : null
          )}
          {hover !== null && (
            <rect x={padL + hover * band} y={padT} width={band} height={plotH} fill="var(--pf-hover)" />
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--pf-grid)" strokeWidth={1} />
              <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="pf-axis">
                {tickFormat(t)}
              </text>
            </g>
          ))}
          {items.map((it, i) => {
            const x0 = padL + i * band + (band - groupW) / 2;
            if (it.untracked) {
              return (
                <rect
                  key={it.key}
                  x={x0}
                  y={padT + plotH * 0.55}
                  width={groupW}
                  height={plotH * 0.45}
                  rx={3}
                  fill="url(#pf-hatch)"
                />
              );
            }
            const maxV = Math.max(...it.values);
            return (
              <g key={it.key} opacity={it.muted ? 0.45 : 1}>
                {it.values.map((v, s) => (
                  <path
                    key={series[s].key}
                    d={barPath(x0 + s * (barW + 2), y(v), barW, padT + plotH - y(v))}
                    fill={series[s].color}
                  />
                ))}
                {it.tag && maxV > 0 && (
                  <text x={x0 + groupW / 2} y={y(maxV) - 6} textAnchor="middle" className="pf-tag">
                    {it.tag}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={padL} x2={width - padR} y1={padT + plotH} y2={padT + plotH} stroke="var(--line-2)" strokeWidth={1} />
          {items.map((it, i) =>
            i % labelEvery === 0 || items.length <= 8 ? (
              <text key={`l${it.key}`} x={padL + i * band + band / 2} y={height - 6} textAnchor="middle" className="pf-axis">
                {it.label}
              </text>
            ) : null
          )}
          {items.map((it, i) => (
            <rect
              key={`h${it.key}`}
              x={padL + i * band}
              y={0}
              width={band}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip x={padL + hover * band + band / 2} y={4} width={width}>
          {tooltip(hover)}
        </Tooltip>
      )}
    </div>
  );
};

const Legend: React.FC<{ series: Series[] }> = ({ series }) => (
  <div className="pf-legend">
    {series.map((s) => (
      <span key={s.key}>
        <i style={{ background: s.color }} />
        {s.label}
      </span>
    ))}
  </div>
);

// ─── peças ───────────────────────────────────────────────────────────

const Delta: React.FC<{ now: number; before: number; show: boolean; label: string }> = ({ now, before, show, label }) => {
  if (!show) return <span className="pf-delta none">sem base para comparar</span>;
  if (before === 0 && now === 0) return <span className="pf-delta none">igual a {label}</span>;
  if (before === 0) return <span className="pf-delta up">novo em relação a {label}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return (
    <span className={`pf-delta ${dir}`}>
      {dir === "up" ? "▲" : dir === "down" ? "▼" : "■"} {pct > 0 ? "+" : ""}
      {pct}% vs {label}
    </span>
  );
};

const Stat: React.FC<{
  icon: IconName;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: React.ReactNode;
}> = ({ icon, label, value, sub, delta }) => (
  <div className="pf-stat">
    <span className="pf-stat-label">
      <Icon name={icon} size={14} />
      {label}
    </span>
    <strong className="pf-stat-value">{value}</strong>
    {delta}
    {sub && <span className="pf-stat-sub">{sub}</span>}
  </div>
);

const Card: React.FC<{
  title: string;
  icon: IconName;
  meta?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, icon, meta, className, children }) => (
  <section className={`pf-card ${className ?? ""}`}>
    <header className="pf-card-head">
      <Icon name={icon} size={15} />
      <h3>{title}</h3>
      {meta && <span className="pf-card-meta">{meta}</span>}
    </header>
    <div className="pf-card-body">{children}</div>
  </section>
);

const DayTip: React.FC<{ p: DailyPoint }> = ({ p }) => (
  <>
    <strong>{fmtDayLong(p.day)}</strong>
    {p.tracked ? (
      <span>
        Edição <b>{fmtDuration(p.editSeconds)}</b>
      </span>
    ) : (
      <span className="pf-tip-muted">tempo ainda não era medido</span>
    )}
    <span>
      Vídeos editados <b>{p.videosEdited}</b>
    </span>
    <span>
      Renderizados <b>{p.rendered}</b>
    </span>
    <span>
      Entregues <b>{p.delivered}</b>
    </span>
  </>
);

/** Mapa de calor: dia da semana × hora (minutos de edição no período) */
const Heatmap: React.FC<{ data: number[][] }> = ({ data }) => {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const withData = data.flatMap((row) => row.map((v, h) => (v > 0 ? h : -1))).filter((h) => h >= 0);
  const h0 = Math.min(7, ...withData);
  const h1 = Math.max(22, ...withData);
  const hours = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
  const max = Math.max(0, ...data.flat());
  const LEVELS = [22, 42, 62, 82, 100];
  const level = (v: number) => (v <= 0 || max === 0 ? -1 : Math.min(4, Math.floor((v / max) * 5 - 1e-9)));
  const fill = (v: number) => {
    const l = level(v);
    return l < 0 ? "var(--n-2)" : `color-mix(in oklch, var(--accent) ${LEVELS[l]}%, var(--n-2))`;
  };
  const peak = (() => {
    let best = { d: 0, h: 0, v: 0 };
    data.forEach((row, d) => row.forEach((v, h) => v > best.v && (best = { d, h, v })));
    return best.v > 0 ? best : null;
  })();
  return (
    <div className="pf-heat-wrap">
      <div className="pf-heat" style={{ gridTemplateColumns: `34px repeat(${hours.length}, minmax(0, 1fr))` }}>
        {data.map((row, d) => (
          <React.Fragment key={d}>
            <span className="pf-heat-day">{WEEKDAYS[d]}</span>
            {hours.map((h) => (
              <span
                key={h}
                className={`pf-heat-cell ${hover?.d === d && hover.h === h ? "on" : ""}`}
                style={{ background: fill(row[h]) }}
                onMouseEnter={() => setHover({ d, h })}
                onMouseLeave={() => setHover(null)}
                aria-label={`${WEEKDAYS_LONG[d]} ${h}h: ${fmtDuration(row[h])}`}
              />
            ))}
          </React.Fragment>
        ))}
        <span />
        {hours.map((h) => (
          <span key={h} className="pf-heat-hour">
            {h % 3 === 0 ? `${h}h` : ""}
          </span>
        ))}
      </div>
      <div className="pf-heat-foot">
        <span className="pf-heat-read">
          {hover
            ? `${WEEKDAYS_LONG[hover.d]}, ${hover.h}h–${hover.h + 1}h · ${fmtDuration(data[hover.d][hover.h])} de edição`
            : peak
              ? `Pico: ${WEEKDAYS_LONG[peak.d]}, ${peak.h}h–${peak.h + 1}h`
              : "Sem edição medida no período"}
        </span>
        <span className="pf-heat-scale">
          menos
          {[-1, 0, 1, 2, 3, 4].map((l) => (
            <i key={l} style={{ background: l < 0 ? "var(--n-2)" : `color-mix(in oklch, var(--accent) ${LEVELS[l]}%, var(--n-2))` }} />
          ))}
          mais
        </span>
      </div>
    </div>
  );
};

const DayRank: React.FC<{ title: string; tone: "best" | "worst"; days: DailyPoint[]; empty: string }> = ({
  title,
  tone,
  days,
  empty,
}) => (
  <div className={`pf-rank ${tone}`}>
    <h4>{title}</h4>
    {days.length === 0 ? (
      <p className="pf-empty">{empty}</p>
    ) : (
      <ol>
        {days.map((d) => (
          <li key={d.day}>
            <span className="pf-rank-day">{fmtDayLong(d.day)}</span>
            <span className="pf-rank-val">{fmtDuration(d.editSeconds)}</span>
            <span className="pf-rank-sub">
              {plural(d.videosEdited, "vídeo", "vídeos")} · {d.delivered} entregue{d.delivered === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ol>
    )}
  </div>
);

/** Linha do tempo de uma demanda: pedido → data definida → entrega, com o prazo */
const DemandTimeline: React.FC<{ row: DemandTimeRow; maxDays: number }> = ({ row, maxDays }) => {
  const start = Date.parse(row.requestedAt);
  const span = Math.max(1, maxDays) * 86_400_000;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - start) / span) * 100));
  const end = pct(Date.parse(row.deliveredAt));
  const set = row.dateSetAt && !row.cameWithDate ? pct(Date.parse(row.dateSetAt)) : 0;
  const due = row.dueDate ? pct(Date.parse(`${row.dueDate}T23:59:00`)) : null;
  return (
    <div className="pf-tl" aria-hidden="true">
      <span className="pf-tl-track" />
      {set > 0 && <span className="pf-tl-seg wait" style={{ left: 0, width: `${set}%` }} />}
      <span
        className={`pf-tl-seg work ${row.onTime === false ? "late" : ""}`}
        style={{ left: `calc(${set}% + ${set > 0 ? 2 : 0}px)`, width: `max(4px, calc(${end - set}% - ${set > 0 ? 2 : 0}px))` }}
      />
      {due !== null && <span className="pf-tl-due" style={{ left: `${due}%` }} title={`Prazo ${fmtDay(row.dueDate!)}`} />}
    </div>
  );
};

// ─── painel ──────────────────────────────────────────────────────────

export const PerformancePanel: React.FC<{ onOpenDemand: (id: string) => void }> = ({ onOpenDemand }) => {
  const [preset, setPreset] = useState<Preset>("30");
  const [user, setUser] = useState<string>("");
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getPerformance({ ...rangeFor(preset), user: user || null })
      .then(setReport)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [preset, user]);
  useEffect(load, [load]);

  const r = report;
  const derived = useMemo(() => {
    if (!r) return null;
    const t = r.totals;
    const p = r.previous;
    const comparable = !!r.trackingSince && r.trackingSince <= p.from;
    const bestWeekday = r.weekdays.reduce<number | null>(
      (best, w) =>
        w.avgEditSeconds !== null && (best === null || w.avgEditSeconds > (r.weekdays[best].avgEditSeconds ?? 0))
          ? w.weekday
          : best,
      null
    );
    // escala comum das linhas do tempo: a entrega ou o prazo mais distante do pedido
    const maxLead = Math.max(
      1,
      ...r.demands.rows.map((x) =>
        Math.max(
          x.leadDays,
          x.dueDate ? (Date.parse(`${x.dueDate}T23:59:00`) - Date.parse(x.requestedAt)) / 86_400_000 : 0
        )
      )
    );
    const bestDay = r.best[0]?.day ?? null;
    return { t, p, comparable, bestWeekday, maxLead, bestDay };
  }, [r]);

  const prevLabel = r ? `${fmtDay(r.previous.from)}–${fmtDay(r.previous.to)}` : "";

  return (
    <div className="pf">
      <div className="pf-toolbar">
        <div className="pf-seg" role="tablist" aria-label="Período">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={preset === p.id}
              className={preset === p.id ? "on" : ""}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="pf-select">
          <Icon name="user" size={14} />
          <select value={user} onChange={(e) => setUser(e.target.value)} aria-label="Editor">
            <option value="">Todos os editores</option>
            {r?.editors.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        {r && (
          <span className="pf-range">
            {fmtDay(r.from)} – {fmtDay(r.to)} · comparado a {prevLabel}
          </span>
        )}
        <button className="icon" title="Atualizar" disabled={loading} onClick={load}>
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {error && <p className="note error">{error}</p>}
      {!r || !derived ? (
        !error && <p className="pf-empty">Carregando…</p>
      ) : (
        <>
          {!r.trackingReady && (
            <p className="pf-notice warn">
              <Icon name="flag" size={14} />O banco ainda não tem as tabelas de medição. Aplique o bloco novo de{" "}
              <code>db/vision.sql</code> (edit_activity e work_events) para começar a medir tempo de edição e renders.
            </p>
          )}
          {r.trackingReady && (!r.trackingSince || r.trackingSince > r.from) && (
            <p className="pf-notice">
              <Icon name="clock" size={14} />
              {r.trackingSince
                ? `Tempo de edição e renders medidos desde ${fmtDay(r.trackingSince)}. Os dias antes disso aparecem tracejados e ficam fora das médias.`
                : "O tempo de edição começa a ser medido assim que alguém abrir um projeto no editor. Entregas e prazos já usam o histórico."}
            </p>
          )}

          {/* ─── números do período ─── */}
          <div className="pf-top">
            <div className="pf-hero">
              <span className="pf-hero-label">Tempo real de edição</span>
              <strong className="pf-hero-value">{fmtDuration(derived.t.editSeconds)}</strong>
              <Delta now={derived.t.editSeconds} before={derived.p.editSeconds} show={derived.comparable} label={prevLabel} />
              <div className="pf-hero-facts">
                <span>
                  <b>{derived.t.daysWorked}</b> {derived.t.daysWorked === 1 ? "dia trabalhado" : "dias trabalhados"}
                </span>
                <span>
                  <b>{derived.t.daysWorked ? fmtDuration(derived.t.editSeconds / derived.t.daysWorked) : "—"}</b> por dia
                  trabalhado
                </span>
                <span>
                  <b>{fmtDuration(r.weeklyAvg.editSeconds)}</b> por semana
                </span>
              </div>
            </div>
            <div className="pf-stats">
              <Stat
                icon="wand"
                label="Vídeos editados"
                value={derived.t.videosEdited}
                delta={<Delta now={derived.t.videosEdited} before={derived.p.videosEdited} show={derived.comparable} label={prevLabel} />}
                sub="projetos com tempo de edição"
              />
              <Stat
                icon="export"
                label="Renderizados"
                value={derived.t.rendered}
                delta={<Delta now={derived.t.rendered} before={derived.p.rendered} show={derived.comparable} label={prevLabel} />}
                sub={`${plural(derived.t.renders, "render", "renders")} no total`}
              />
              <Stat
                icon="film"
                label="Entregues"
                value={derived.t.delivered}
                delta={<Delta now={derived.t.delivered} before={derived.p.delivered} show label={prevLabel} />}
                sub={`${plural(derived.t.demandsDelivered, "demanda completa", "demandas completas")} · ${
                  r.weeklyAvg.delivered === null ? "—" : num(r.weeklyAvg.delivered)
                } por semana`}
              />
              <Stat
                icon="clock"
                label="Edição por vídeo"
                value={fmtDuration(r.perVideo.avgEditSeconds)}
                sub={
                  r.perVideo.sample
                    ? `média de ${plural(r.perVideo.sample, "vídeo entregue", "vídeos entregues")}`
                    : "nenhum vídeo entregue com tempo medido"
                }
              />
            </div>
          </div>

          {/* ─── ritmo diário ─── */}
          <Card title="Ritmo diário" icon="chart" meta="passe o mouse para ver o dia">
            <div className="pf-chart-title">
              <span>Horas de edição por dia</span>
              {r.best[0] && (
                <span className="pf-chart-note">
                  melhor dia: {fmtDayLong(r.best[0].day)} · {fmtDuration(r.best[0].editSeconds)}
                </span>
              )}
            </div>
            <ColumnChart
              ariaLabel="Horas de edição por dia"
              items={r.daily.map((p) => ({
                key: p.day,
                label: r.days <= 8 ? `${WEEKDAYS[p.weekday]} ${fmtDay(p.day)}` : fmtDay(p.day),
                values: [p.editSeconds / 3600],
                untracked: !p.tracked,
                shaded: p.weekday >= 5,
                tag: p.day === derived.bestDay ? fmtDuration(p.editSeconds) : undefined,
              }))}
              series={[{ key: "h", label: "Horas de edição", color: "var(--accent)" }]}
              tickFormat={(v) => `${num(v)}h`}
              tooltip={(i) => <DayTip p={r.daily[i]} />}
              minLabelGap={r.days <= 8 ? 64 : 44}
            />
            <div className="pf-chart-title second">
              <span>Vídeos por dia</span>
              <Legend
                series={[
                  { key: "r", label: "Renderizados", color: "var(--pf-c1)" },
                  { key: "d", label: "Entregues", color: "var(--pf-c2)" },
                ]}
              />
            </div>
            <ColumnChart
              ariaLabel="Vídeos renderizados e entregues por dia"
              height={140}
              items={r.daily.map((p) => ({
                key: p.day,
                label: r.days <= 8 ? `${WEEKDAYS[p.weekday]} ${fmtDay(p.day)}` : fmtDay(p.day),
                values: [p.rendered, p.delivered],
                shaded: p.weekday >= 5,
              }))}
              series={[
                { key: "r", label: "Renderizados", color: "var(--pf-c1)" },
                { key: "d", label: "Entregues", color: "var(--pf-c2)" },
              ]}
              tickFormat={(v) => String(v)}
              integer
              tooltip={(i) => <DayTip p={r.daily[i]} />}
              minLabelGap={r.days <= 8 ? 64 : 44}
            />
          </Card>

          {/* ─── dias e horários ─── */}
          <div className="pf-grid">
            <Card title="Dias mais e menos produtivos" icon="calendar" meta="dias completos com medição">
              <div className="pf-chart-title">
                <span>Média de edição por dia da semana</span>
                {derived.bestWeekday !== null && (
                  <span className="pf-chart-note">
                    rende mais {derived.bestWeekday >= 5 ? "no" : "na"} {WEEKDAYS_LONG[derived.bestWeekday]}
                  </span>
                )}
              </div>
              <ColumnChart
                ariaLabel="Média de horas de edição por dia da semana"
                height={150}
                items={r.weekdays.map((w) => ({
                  key: String(w.weekday),
                  label: WEEKDAYS[w.weekday],
                  values: [(w.avgEditSeconds ?? 0) / 3600],
                  muted: derived.bestWeekday !== null && w.weekday !== derived.bestWeekday,
                  untracked: w.samples === 0,
                }))}
                series={[{ key: "h", label: "Média de horas", color: "var(--accent)" }]}
                tickFormat={(v) => `${num(v)}h`}
                tooltip={(i) => {
                  const w = r.weekdays[i];
                  return (
                    <>
                      <strong>{WEEKDAYS_LONG[w.weekday]}</strong>
                      {w.samples === 0 ? (
                        <span className="pf-tip-muted">sem dias medidos no período</span>
                      ) : (
                        <>
                          <span>
                            Edição média <b>{fmtDuration(w.avgEditSeconds)}</b>
                          </span>
                          <span>
                            Entregas médias <b>{num(w.avgDelivered ?? 0)}</b>
                          </span>
                          <span className="pf-tip-muted">{plural(w.samples, "dia", "dias")} no cálculo</span>
                        </>
                      )}
                    </>
                  );
                }}
              />
              <div className="pf-ranks">
                <DayRank title="Mais produtivos" tone="best" days={r.best} empty="Sem edição medida no período." />
                <DayRank
                  title="Menos produtivos"
                  tone="worst"
                  days={r.worst}
                  empty="Precisa de mais dias úteis medidos."
                />
              </div>
            </Card>

            <Card title="Quando a edição acontece" icon="clock" meta="dia da semana × hora">
              <Heatmap data={r.heatmap} />
            </Card>
          </div>

          {/* ─── semanas ─── */}
          <Card title="Média semanal" icon="board" meta="últimas 8 semanas">
            <div className="pf-weekly-head">
              <div>
                <span className="pf-mini-label">Edição por semana</span>
                <strong>{fmtDuration(r.weeklyAvg.editSeconds)}</strong>
              </div>
              <div>
                <span className="pf-mini-label">Entregas por semana</span>
                <strong>{r.weeklyAvg.delivered === null ? "—" : num(r.weeklyAvg.delivered)}</strong>
              </div>
              <span className="pf-chart-note">média das semanas completas · a atual aparece mais clara</span>
            </div>
            <ColumnChart
              ariaLabel="Horas de edição por semana"
              height={160}
              items={r.weekly.map((w) => ({
                key: w.weekStart,
                label: fmtDay(w.weekStart),
                values: [w.editSeconds / 3600],
                untracked: !w.tracked,
                muted: !w.complete,
              }))}
              series={[{ key: "h", label: "Horas de edição", color: "var(--accent)" }]}
              tickFormat={(v) => `${num(v)}h`}
              tooltip={(i) => {
                const w = r.weekly[i];
                return (
                  <>
                    <strong>
                      Semana de {fmtDay(w.weekStart)} a {fmtDay(shiftDay(w.weekStart, 6))}
                      {!w.complete && " (em andamento)"}
                    </strong>
                    <span>
                      Edição <b>{w.tracked ? fmtDuration(w.editSeconds) : "não medida"}</b>
                    </span>
                    <span>
                      Dias trabalhados <b>{w.daysWorked}</b>
                    </span>
                    <span>
                      Renderizados <b>{w.rendered}</b>
                    </span>
                    <span>
                      Entregues <b>{w.delivered}</b>
                    </span>
                  </>
                );
              }}
              minLabelGap={40}
            />
          </Card>

          {/* ─── demandas ─── */}
          <Card title="Tempo das demandas" icon="flag" meta="demandas com todos os vídeos entregues no período">
            <div className="pf-dstats">
              <div>
                <span className="pf-mini-label">Pedido → entrega</span>
                <strong>{r.demands.avgLeadDays === null ? "—" : `${num(r.demands.avgLeadDays)} dias`}</strong>
                <span className="pf-mini-sub">média de {plural(r.demands.sample, "demanda", "demandas")}</span>
              </div>
              <div>
                <span className="pf-mini-label">Tempo para definir a data</span>
                <strong>{fmtHoursSpan(r.demands.avgDateSetHours)}</strong>
                <span className="pf-mini-sub">
                  {r.demands.dateSetSample
                    ? `${plural(r.demands.dateSetSample, "data definida", "datas definidas")} no período`
                    : "nenhuma data definida no período"}
                </span>
              </div>
              <div>
                <span className="pf-mini-label">Entregues no prazo</span>
                <strong>{r.demands.onTimeRate === null ? "—" : `${Math.round(r.demands.onTimeRate * 100)}%`}</strong>
                {r.demands.onTimeRate !== null && (
                  <span className="pf-meter">
                    <span style={{ width: `${r.demands.onTimeRate * 100}%` }} />
                  </span>
                )}
              </div>
              <div className={r.demands.waitingDate > 0 ? "attn" : ""}>
                <span className="pf-mini-label">Aguardando data agora</span>
                <strong>{r.demands.waitingDate}</strong>
                <span className="pf-mini-sub">
                  {r.demands.oldestWaitingDays !== null
                    ? `a mais antiga pedida há ${plural(r.demands.oldestWaitingDays, "dia", "dias")}`
                    : "nenhuma sem data"}
                </span>
              </div>
            </div>

            {r.demands.rows.length === 0 ? (
              <p className="pf-empty">Nenhuma demanda concluída no período.</p>
            ) : (
              <>
                <div className="pf-dlegend">
                  <span>
                    <i className="wait" />
                    Definindo a data
                  </span>
                  <span>
                    <i className="work" />
                    Data definida → entrega
                  </span>
                  <span>
                    <i className="late" />
                    Entregue depois do prazo
                  </span>
                  <span>
                    <i className="due" />
                    Prazo
                  </span>
                </div>
                <div className="pf-dtable" role="table" aria-label="Tempo de cada demanda">
                  <div className="pf-drow head" role="row">
                    <span role="columnheader">Demanda</span>
                    <span role="columnheader">Linha do tempo</span>
                    <span role="columnheader">Pedido</span>
                    <span role="columnheader">Data definida</span>
                    <span role="columnheader">Entregue</span>
                    <span role="columnheader">Total</span>
                    <span role="columnheader">Edição real</span>
                    <span role="columnheader">Prazo</span>
                  </div>
                  {r.demands.rows.map((row) => (
                    <button key={row.demandId} className="pf-drow" role="row" onClick={() => onOpenDemand(row.demandId)}>
                      <span className="pf-dname" role="cell">
                        <strong>{row.title}</strong>
                        <span>
                          {row.clientName} · {plural(row.videoCount, "vídeo", "vídeos")}
                        </span>
                      </span>
                      <span role="cell">
                        <DemandTimeline row={row} maxDays={derived.maxLead} />
                      </span>
                      <span role="cell" className="pf-num" title={fmtIsoDayTime(row.requestedAt)}>
                        {fmtIsoDay(row.requestedAt)}
                      </span>
                      <span role="cell" className="pf-num">
                        {row.cameWithDate ? (
                          <span className="pf-muted">já veio</span>
                        ) : row.dateSetHours !== null ? (
                          <>
                            {fmtIsoDay(row.dateSetAt!)} <span className="pf-muted">+{fmtHoursSpan(row.dateSetHours)}</span>
                          </>
                        ) : (
                          <span className="pf-muted">—</span>
                        )}
                      </span>
                      <span role="cell" className="pf-num" title={fmtIsoDayTime(row.deliveredAt)}>
                        {fmtIsoDay(row.deliveredAt)}
                      </span>
                      <span role="cell" className="pf-num strong">
                        {num(row.leadDays)} d
                      </span>
                      <span role="cell" className="pf-num">
                        {row.editSeconds > 0 ? fmtDuration(row.editSeconds) : <span className="pf-muted">—</span>}
                      </span>
                      <span role="cell">
                        {row.onTime === null ? (
                          <span className="pf-badge">sem prazo</span>
                        ) : row.onTime ? (
                          <span className="pf-badge ok">
                            <Icon name="check" size={11} /> no prazo
                          </span>
                        ) : (
                          <span className="pf-badge late">
                            <Icon name="flag" size={11} /> {plural(row.lateDays, "dia", "dias")} depois
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* ─── por pessoa ─── */}
          {!r.userId && r.byEditor.length > 1 && (
            <Card title="Por editor" icon="user" meta="no período">
              <table className="pf-etable">
                <thead>
                  <tr>
                    <th>Editor</th>
                    <th>Tempo real</th>
                    <th>Dias</th>
                    <th>Editados</th>
                    <th>Renderizados</th>
                    <th>Entregues</th>
                    <th>Por vídeo</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byEditor.map((e) => {
                    const share = derived.t.editSeconds ? e.editSeconds / derived.t.editSeconds : 0;
                    return (
                      <tr key={e.id} onClick={() => setUser(e.id)} title="Ver só este editor">
                        <td>{e.name}</td>
                        <td>
                          <span className="pf-ebar">
                            <span style={{ width: `${share * 100}%` }} />
                          </span>
                          {fmtDuration(e.editSeconds)}
                        </td>
                        <td>{e.daysWorked}</td>
                        <td>{e.videosEdited}</td>
                        <td>{e.rendered}</td>
                        <td>{e.delivered}</td>
                        <td>{fmtDuration(e.avgPerVideoSeconds)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

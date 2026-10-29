import React from "react";
import { Icon } from "../editor/Icon";
import { dueInfo, fmtDay, initials, priorityTone, statusTone } from "./demandUtil";

/** Selo de prioridade: barras de sinal (3 = alta) + rótulo do War */
export const PriorityBadge: React.FC<{ priority: string | null; compact?: boolean }> = ({ priority, compact }) => {
  if (!priority) return null;
  const tone = priorityTone(priority) ?? "low";
  const level = tone === "high" ? 3 : tone === "mid" ? 2 : 1;
  return (
    <span className={`prio prio-${tone} ${compact ? "compact" : ""}`} title={`Prioridade ${priority}`}>
      <svg className="prio-bars" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <rect key={i} x={1 + i * 4} y={8 - i * 3} width="2.6" height={3 + i * 3} rx="0.8" className={i < level ? "on" : ""} />
        ))}
      </svg>
      {priority}
    </span>
  );
};

/** Bolinha + nome do status, na cor do status */
export const StatusDot: React.FC<{ status: string }> = ({ status }) => (
  <span className={`st-dot st-${statusTone(status)}`} aria-hidden="true" />
);

/** Prazo de entrega com a urgência (atrasada, hoje, em N dias) */
export const DueDate: React.FC<{ dueDate: string | null; done?: boolean; size?: "sm" | "lg" }> = ({
  dueDate,
  done,
  size = "sm",
}) => {
  const info = dueInfo(dueDate);
  if (!info)
    return (
      <span className={`due due-none due-${size}`}>
        <Icon name="calendar" size={size === "lg" ? 15 : 13} />
        Sem data
      </span>
    );
  const tone = done ? "done" : info.tone;
  return (
    <span className={`due due-${tone} due-${size}`} title="Data de entrega">
      <Icon name={tone === "late" ? "flag" : "calendar"} size={size === "lg" ? 15 : 13} />
      <strong>{fmtDay(dueDate)}</strong>
      {!done && <span className="due-rel">{info.label}</span>}
    </span>
  );
};

export const Avatar: React.FC<{ name: string | null; size?: number; className?: string }> = ({
  name,
  size = 22,
  className,
}) => (
  <span
    className={`avatar ${className ?? ""}`}
    style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    title={name ?? undefined}
    // matiz estável por nome: cada pessoa/cliente sempre com a mesma cor
    data-hue={hueOf(name)}
  >
    {initials(name)}
  </span>
);

function hueOf(name: string | null): number {
  let h = 0;
  for (const c of name ?? "") h = (h * 31 + c.charCodeAt(0)) % 360;
  return Math.round(h / 30) % 12;
}

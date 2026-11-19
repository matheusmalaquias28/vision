import React from "react";
import type { EditAuthor } from "../api";
import { Icon } from "../editor/Icon";

/** Iniciais (até 2) de um nome: "Ana Paula Souza" → "AS" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] ?? "");
  return (first + last).toUpperCase();
}

/** Matiz estável por pessoa: a mesma cor no painel e na barra de presença */
export function hueOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

export const Avatar: React.FC<{
  name: string;
  /** chave da cor (id do usuário); padrão = o nome */
  colorKey?: string;
  size?: number;
  className?: string;
  title?: string;
  children?: React.ReactNode;
}> = ({ name, colorKey, size = 22, className = "", title, children }) => (
  <span
    className={`avatar ${className}`}
    title={title ?? name}
    style={{ "--avatar-h": hueOf(colorKey ?? name), width: size, height: size, fontSize: size * 0.42 } as React.CSSProperties}
  >
    {initials(name)}
    {children}
  </span>
);

const list = (names: string[]) =>
  names.length <= 2 ? names.join(" e ") : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;

/** Quem fez a edição: o Vision (edição automática) ou a pessoa, e quem mexeu depois */
export const AuthorChip: React.FC<{ author: EditAuthor }> = ({ author }) => {
  const { startedBy, editors } = author;
  if (startedBy?.kind === "vision") {
    const text = editors.length ? `Vision · ajustado por ${list(editors)}` : "Editado pelo Vision";
    return (
      <span className="author-chip vision" title={editors.length ? `Edição automática do Vision, ajustada por ${list(editors)}` : "Edição automática do Vision, sem alteração manual"}>
        <span className="author-vision-mark">
          <Icon name="sparkles" size={11} />
        </span>
        <span className="author-text">{text}</span>
      </span>
    );
  }
  const main = startedBy?.kind === "user" ? startedBy.name : editors[0];
  if (!main) {
    return (
      <span className="author-chip none" title="Edição de antes do registro de autoria">
        sem registro
      </span>
    );
  }
  const others = startedBy?.kind === "user" ? editors : editors.slice(1);
  const title = `${startedBy?.kind === "user" ? `Começou: ${main}` : `Editou: ${main}`}${others.length ? ` · também editou: ${list(others)}` : ""}`;
  return (
    <span className="author-chip" title={title}>
      <Avatar name={main} size={18} title={title} />
      <span className="author-text">
        {main}
        {others.length > 0 && <span className="author-more"> · com {list(others)}</span>}
      </span>
    </span>
  );
};

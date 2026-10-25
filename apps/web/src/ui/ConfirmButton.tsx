import React, { useEffect, useState } from "react";

interface ConfirmButtonProps {
  /** pergunta curta mostrada no lugar do botão */
  question: string;
  onConfirm: () => void;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

/**
 * Botão de ação sensível com confirmação na própria tela. Substitui o
 * window.confirm, que navegadores embutidos bloqueiam (responde "não" sem
 * mostrar nada). Sem resposta em 8 s, volta ao normal.
 */
export const ConfirmButton: React.FC<ConfirmButtonProps> = ({ question, onConfirm, className, title, children }) => {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!asking) return;
    const t = window.setTimeout(() => setAsking(false), 8000);
    return () => window.clearTimeout(t);
  }, [asking]);

  if (!asking) {
    return (
      <button className={className} title={title} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }
  return (
    <span className="confirm-inline" role="group" aria-label={question}>
      <span>{question}</span>
      <button
        className="sm danger"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Sim
      </button>
      <button className="sm ghost" onClick={() => setAsking(false)}>
        Não
      </button>
    </span>
  );
};

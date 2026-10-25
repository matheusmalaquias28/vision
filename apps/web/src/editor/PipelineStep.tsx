import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * Passo do fluxo do topo (Transcrever → Sugerir cortes → Sugerir motions) em
 * forma de seta encaixada na próxima. Enquanto roda, uma luz corre por dentro
 * da seta; ao terminar com sucesso, uma faixa verde varre a seta e o ✓ entra.
 */
export const PipelineStep: React.FC<{
  n: number;
  label: string;
  /** Texto enquanto processa ("Transcrevendo") */
  runningLabel: string;
  done: boolean;
  running: boolean;
  disabled: boolean;
  first?: boolean;
  /** Atraso da luz (s): no "Analisar e aplicar" a luz percorre as setas em sequência */
  lightDelay?: number;
  title: string;
  onClick: () => void;
  /** Controle extra dentro da seta (ex.: ritmo dos cortes) */
  children?: React.ReactNode;
}> = ({ n, label, runningLabel, done, running, disabled, first, lightDelay = 0, title, onClick, children }) => {
  const [justDone, setJustDone] = useState(false);
  const wasRunning = useRef(running);
  useEffect(() => {
    // terminou agora e deu certo: anima a conclusão (falhou = sem festa)
    if (wasRunning.current && !running && done) {
      setJustDone(true);
      const t = setTimeout(() => setJustDone(false), 1400);
      wasRunning.current = running;
      return () => clearTimeout(t);
    }
    wasRunning.current = running;
  }, [running, done]);

  const cls = [
    "pipe",
    first ? "first" : "",
    done ? "done" : "",
    running ? "running" : "",
    justDone ? "just-done" : "",
    disabled && !running ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={{ "--light-delay": `${lightDelay}s` } as React.CSSProperties}>
      <button className="pipe-btn" disabled={disabled} onClick={onClick} title={title}>
        <span className="pipe-num">{done && !running ? <Icon name="check" size={10} /> : n}</span>
        <span className="pipe-label">{running ? `${runningLabel}…` : label}</span>
      </button>
      {children}
    </div>
  );
};

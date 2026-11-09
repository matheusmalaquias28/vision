import { useEffect } from "react";
import { sendEditActivity } from "../api";

/**
 * Tempo REAL de edição (painel de desempenho): conta só os segundos em que o
 * editor está aberto, com a aba visível e em uso — mexeu mouse/teclado nos
 * últimos 2 min ou o preview está tocando. Editor esquecido aberto não conta.
 * Envia a cada minuto e ao sair/esconder a aba; o servidor ainda limita pelo
 * tempo real entre envios (duas abas não contam em dobro).
 */
const TICK_MS = 5_000;
const FLUSH_MS = 60_000;
export const IDLE_MS = 120_000;

const mediaPlaying = () =>
  Array.from(document.querySelectorAll("video, audio")).some((m) => !(m as HTMLMediaElement).paused);

export function useEditTracker(projectId: string) {
  useEffect(() => {
    let lastInput = Date.now();
    let pending = 0;
    let lastTick = Date.now();
    let lastFlush = Date.now();

    const onInput = () => {
      lastInput = Date.now();
    };
    const flush = () => {
      lastFlush = Date.now();
      const s = Math.round(pending);
      if (s < 1) return;
      pending -= s;
      void sendEditActivity(projectId, s);
    };
    const tick = () => {
      const now = Date.now();
      // aba dormindo (timer atrasado) nunca conta mais que um tique
      const dt = Math.min(now - lastTick, TICK_MS * 2);
      lastTick = now;
      const active = document.visibilityState === "visible" && (now - lastInput < IDLE_MS || mediaPlaying());
      if (active) pending += dt / 1000;
      if (now - lastFlush >= FLUSH_MS) flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else lastTick = Date.now();
    };

    const opts = { passive: true, capture: true } as const;
    const inputs = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    for (const e of inputs) window.addEventListener(e, onInput, opts);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    const t = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearInterval(t);
      tick();
      flush();
      for (const e of inputs) window.removeEventListener(e, onInput, opts);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [projectId]);
}

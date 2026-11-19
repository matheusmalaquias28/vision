import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { leavePresence, sendPresence, type PresenceUser, type PresenceWhere } from "../api";
import { Avatar } from "./Avatar";

/**
 * Presença: cada aba avisa o servidor onde está (a cada 20 s, ao trocar de
 * tela e ao voltar a ficar visível) e recebe quem mais está online. "Em uso"
 * = aba visível com mouse/teclado nos últimos 2 min ou mídia tocando (a mesma
 * régua do tempo de edição).
 */
const BEAT_MS = 20_000;
const IDLE_MS = 120_000;

/** Id da aba: sobrevive ao recarregar (sessionStorage), cada aba nova ganha outro */
function tabId(): string {
  const key = "vision:tab-id";
  try {
    const have = sessionStorage.getItem(key);
    if (have) return have;
    const id = Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

const mediaPlaying = () =>
  Array.from(document.querySelectorAll("video, audio")).some((m) => !(m as HTMLMediaElement).paused);

export interface PresenceState {
  me: string | null;
  users: PresenceUser[];
  /** onde esta aba está (para destacar quem está no mesmo vídeo) */
  where: PresenceWhere;
}

const PresenceContext = createContext<PresenceState>({ me: null, users: [], where: { view: "demandas" } });

export const usePresenceState = () => useContext(PresenceContext);

/** Liga o batimento desta aba; `where` muda = batimento na hora */
export function usePresence(where: PresenceWhere): PresenceState {
  const [state, setState] = useState<{ me: string | null; users: PresenceUser[] }>({ me: null, users: [] });
  const id = useRef(tabId()).current;
  const lastInput = useRef(Date.now());
  const whereRef = useRef(where);
  whereRef.current = where;
  const key = `${where.view}:${where.projectId ?? ""}:${where.demandId ?? ""}`;

  useEffect(() => {
    let alive = true;
    const beat = () => {
      const active =
        document.visibilityState === "visible" && (Date.now() - lastInput.current < IDLE_MS || mediaPlaying());
      sendPresence({ ...whereRef.current, tabId: id, active })
        .then((r) => alive && setState({ me: r.me, users: r.users }))
        .catch(() => undefined);
    };
    beat();
    const t = window.setInterval(beat, BEAT_MS);
    // parado → mexeu: avisa na hora (o ícone acende sem esperar 20 s)
    const onInput = () => {
      const wasIdle = Date.now() - lastInput.current >= IDLE_MS;
      lastInput.current = Date.now();
      if (wasIdle) beat();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") lastInput.current = Date.now();
      beat();
    };
    const onLeave = () => leavePresence(id);
    const opts = { passive: true, capture: true } as const;
    const inputs = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    for (const e of inputs) window.addEventListener(e, onInput, opts);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onLeave);
    return () => {
      alive = false;
      window.clearInterval(t);
      for (const e of inputs) window.removeEventListener(e, onInput, opts);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, id]);

  // saiu do Vision (logout): some da barra dos outros na hora
  useEffect(() => () => leavePresence(id), [id]);

  return { ...state, where };
}

export const PresenceProvider: React.FC<{ value: PresenceState; children: React.ReactNode }> = ({ value, children }) => (
  <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
);

const MAX_FACES = 5;

function ago(iso: string | null): string {
  if (!iso) return "parado desde que abriu";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `parado há ${min} min`;
  return `parado há ${Math.floor(min / 60)} h`;
}

const placeText = (u: PresenceUser) => {
  const p = u.places[0];
  return p ? `${p.label}${p.detail ? ` ${p.detail}` : ""}` : "online";
};

/**
 * Ícones fixos na barra superior: quem mais está online (em uso = ponto
 * verde) e, ao passar o mouse ou clicar, onde cada um está.
 */
export const PresenceBar: React.FC<{ onOpenDemand?: (id: string) => void }> = ({ onOpenDemand }) => {
  const { me, users, where } = usePresenceState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!me) return null;
  const others = users.filter((u) => u.userId !== me);
  const self = users.find((u) => u.userId === me);
  const sameVideo = (u: PresenceUser) =>
    where.view === "editor" && !!where.projectId && u.places.some((p) => p.view === "editor" && p.projectId === where.projectId);
  const faces = others.slice(0, MAX_FACES);
  const extra = others.length - faces.length;

  return (
    <div className="presence popover-anchor" ref={ref}>
      <button
        className={`presence-stack ${others.length === 0 ? "alone" : ""}`}
        title={others.length === 0 ? "Só você online agora" : others.map((u) => `${u.name}: ${placeText(u)}`).join("\n")}
        aria-label={`${others.length} ${others.length === 1 ? "pessoa online" : "pessoas online"}`}
        onClick={() => setOpen((o) => !o)}
      >
        {others.length === 0 ? (
          <span className="presence-alone">só você</span>
        ) : (
          <>
            {faces.map((u) => (
              <Avatar
                key={u.userId}
                name={u.name}
                colorKey={u.userId}
                size={26}
                className={`presence-face ${u.active ? "on" : "idle"} ${sameVideo(u) ? "same" : ""}`}
                title={`${u.name}: ${placeText(u)}${u.active ? "" : ` (${ago(u.lastActiveAt)})`}${sameVideo(u) ? " — no mesmo vídeo que você" : ""}`}
              >
                <i className="presence-dot" />
              </Avatar>
            ))}
            {extra > 0 && <span className="presence-extra">+{extra}</span>}
          </>
        )}
      </button>
      {open && (
        <div className="popover presence-pop">
          <div className="menu-label">Online agora</div>
          {[...others, ...(self ? [self] : [])].map((u) => (
            <div key={u.userId} className={`presence-row ${u.active ? "on" : "idle"}`}>
              <Avatar name={u.name} colorKey={u.userId} size={28} className={`presence-face ${u.active ? "on" : "idle"}`}>
                <i className="presence-dot" />
              </Avatar>
              <div className="presence-who">
                <strong>
                  {u.name}
                  {u.userId === me && <span className="presence-you"> (você)</span>}
                  {sameVideo(u) && u.userId !== me && <span className="presence-same">mesmo vídeo</span>}
                </strong>
                {u.places.map((p, i) => {
                  const canOpen = !!p.demandId && !!onOpenDemand && u.userId !== me;
                  const text = (
                    <>
                      <span className="presence-label">{p.label}</span>
                      {p.detail && <span className="presence-detail"> {p.detail}</span>}
                    </>
                  );
                  return canOpen ? (
                    <button
                      key={i}
                      className="presence-place link"
                      title="Abrir a demanda"
                      onClick={() => {
                        setOpen(false);
                        onOpenDemand!(p.demandId!);
                      }}
                    >
                      {text}
                    </button>
                  ) : (
                    <span key={i} className="presence-place">
                      {text}
                    </span>
                  );
                })}
                <span className="presence-when">{u.active ? "em uso agora" : ago(u.lastActiveAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

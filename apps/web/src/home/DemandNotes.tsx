import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDemandNote, resendDemandNote, type DemandNote } from "../api";
import { Icon } from "../editor/Icon";
import { useCurrentUser } from "../ui/user";
import { Avatar } from "./DemandBadges";
import { fmtChatDay, fmtTime, MENTION_NAMES, safeUrl } from "./demandUtil";

interface DemandNotesProps {
  demandId: string;
  notes: DemandNote[];
  /** gestor, solicitante, editor: entram nas menções junto da lista fixa */
  people: (string | null)[];
  onChanged: () => void;
}

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** mesma pessoa em menos de 5 min no mesmo dia: um balão colado no outro */
const GROUP_MS = 5 * 60_000;

/** "@" + palavra logo antes do cursor (o nome pode ter espaço, a busca não) */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = text.slice(0, caret).match(/(^|\s)@([\p{L}\p{N}_.]*)$/u);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

/** Texto com as menções conhecidas destacadas (nome mais longo ganha: "Pedro Henrique" antes de "Pedro") */
const NoteText: React.FC<{ text: string; names: string[] }> = ({ text, names }) => {
  const re = useMemo(() => {
    const alts = [...names]
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return alts.length ? new RegExp(`@(?:${alts.join("|")})(?![\\p{L}\\p{N}])`, "giu") : null;
  }, [names]);
  if (!re) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    out.push(
      <span key={m.index} className="mention">
        {m[0]}
      </span>
    );
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
};

/** Conversa da demanda: notas do War (esquerda) e do Vision (direita) como chat */
export const DemandNotes: React.FC<DemandNotesProps> = ({ demandId, notes, people, onChanged }) => {
  const user = useCurrentUser();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [pick, setPick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = notes
    .filter((n) => !n.apagadoEm)
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));

  const names = useMemo(() => {
    const seen = new Set<string>();
    return [...MENTION_NAMES, ...people].filter((n): n is string => {
      const k = n ? plain(n.trim()) : "";
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [people.join("|")]);

  const options = useMemo(() => {
    if (!mention) return [];
    const q = plain(mention.query);
    const starts = names.filter((n) => plain(n).startsWith(q));
    const inside = names.filter((n) => !plain(n).startsWith(q) && plain(n).includes(q));
    return [...starts, ...inside].slice(0, 8);
  }, [mention, names]);

  // conversa abre e segue no fim (só quando chega mensagem nova, não a cada recarga)
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  // a caixa cresce com o texto até 6 linhas
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  useEffect(() => setPick(0), [mention?.query]);

  const trackMention = (value: string, caret: number) => setMention(mentionQuery(value, caret));

  const insertMention = (name: string) => {
    if (!mention) return;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${name} ${text.slice(caret)}`;
    const pos = mention.start + name.length + 2;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const n = await addDemandNote(demandId, text);
      if (n.syncError) setError(`Salvo no Vision, mas o War não recebeu: ${n.syncError}`);
      setText("");
      setMention(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const resend = async (criadoEm: string) => {
    setError(null);
    try {
      const n = await resendDemandNote(demandId, criadoEm);
      if (n.syncError) setError(`O War ainda não recebeu: ${n.syncError}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && options.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setPick((p) => (p + step + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(options[pick] ?? options[0]);
        return;
      }
      if (e.key === "Escape") {
        // fecha só a lista, não o modal
        e.preventDefault();
        e.stopPropagation();
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <section className="chat">
      <header className="chat-head">
        <Icon name="chat" size={15} />
        <h3>Conversa</h3>
        <span className="chat-count">{visible.length}</span>
        <span className="chat-legend">
          <span className="war">War</span>
          <span className="vision">Vision</span>
        </span>
      </header>

      <div className="chat-list" ref={listRef}>
        {visible.length === 0 ? (
          <div className="chat-empty">
            <span className="chat-empty-icon">
              <Icon name="chat" size={20} />
            </span>
            <strong>Nenhuma mensagem ainda</strong>
            <span>O que for escrito aqui aparece nas notas da demanda no War.</span>
          </div>
        ) : (
          visible.map((n, i) => {
            const prev = visible[i - 1];
            const mine = n.origem === "vision";
            const day = fmtChatDay(n.criadoEm);
            const newDay = !prev || fmtChatDay(prev.criadoEm) !== day;
            const grouped =
              !newDay &&
              prev.autor === n.autor &&
              prev.origem === n.origem &&
              Date.parse(n.criadoEm) - Date.parse(prev.criadoEm) < GROUP_MS;
            return (
              <React.Fragment key={n.criadoEm}>
                {newDay && (
                  <div className="chat-day">
                    <span>{day}</span>
                  </div>
                )}
                <div className={`msg ${mine ? "out" : "in"} ${grouped ? "grouped" : ""}`}>
                  {!mine && (grouped ? <span className="msg-avatar-gap" /> : <Avatar name={n.autor} size={28} />)}
                  <div className="msg-col">
                    {!grouped && (
                      <span className="msg-author">
                        {mine && n.autor === user?.name ? "Você" : n.autor}
                        <span className="msg-origin">{mine ? "Vision" : "War"}</span>
                      </span>
                    )}
                    <div className="bubble">
                      {n.texto && (
                        <p>
                          <NoteText text={n.texto} names={names} />
                        </p>
                      )}
                      {n.imagens && n.imagens.length > 0 && (
                        <span className="bubble-imgs">
                          {n.imagens.map((src) => {
                            const url = safeUrl(src);
                            return (
                              url && (
                                <a key={url} href={url} target="_blank" rel="noreferrer noopener">
                                  <img src={url} alt="" loading="lazy" />
                                </a>
                              )
                            );
                          })}
                        </span>
                      )}
                      <span className="bubble-time">
                        {fmtTime(n.criadoEm)}
                        {mine && !n.syncError && <Icon name="check" size={12} />}
                      </span>
                    </div>
                    {n.syncError && (
                      <span className="msg-err" title={n.syncError}>
                        não chegou ao War
                        <button className="sm ghost" onClick={() => resend(n.criadoEm)}>
                          <Icon name="refresh" size={12} />
                          Reenviar
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>

      <div className="chat-composer">
        {mention && options.length > 0 && (
          <ul className="mention-pop" role="listbox" aria-label="Mencionar">
            {options.map((name, i) => (
              <li key={name} role="option" aria-selected={i === pick}>
                <button
                  className={i === pick ? "on" : ""}
                  // mousedown: o clique não pode tirar o foco da caixa antes de inserir
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(name);
                  }}
                  onMouseEnter={() => setPick(i)}
                >
                  <Avatar name={name} size={22} />
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="chat-error">{error}</p>}
        <div className="chat-input">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Escreva para o gestor… @ para mencionar"
            value={text}
            disabled={sending}
            onChange={(e) => {
              setText(e.target.value);
              trackMention(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => trackMention(e.currentTarget.value, e.currentTarget.selectionStart)}
            onBlur={() => setMention(null)}
            onKeyDown={onKeyDown}
          />
          <button
            className="chat-send"
            disabled={!text.trim() || sending}
            onClick={send}
            title="Enviar (Enter)"
            aria-label="Enviar"
          >
            <Icon name="send" size={16} />
          </button>
        </div>
        <span className="chat-hint">
          como <strong>{user?.name}</strong> · Enter envia · Shift+Enter quebra a linha
        </span>
      </div>
    </section>
  );
};

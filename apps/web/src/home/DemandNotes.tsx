import React, { useState } from "react";
import { addDemandNote, resendDemandNote, type DemandNote } from "../api";
import { Icon } from "../editor/Icon";
import { fmtDateTime, safeUrl } from "./demandUtil";

const AUTHOR_KEY = "vision.author";

function readAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
}

interface DemandNotesProps {
  demandId: string;
  notes: DemandNote[];
  onChanged: () => void;
}

/** Conversa da demanda: notas do War e do Vision na mesma linha do tempo */
export const DemandNotes: React.FC<DemandNotesProps> = ({ demandId, notes, onChanged }) => {
  const [author, setAuthor] = useState(readAuthor);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = notes.filter((n) => !n.apagadoEm);

  const send = async () => {
    if (!text.trim() || !author.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      localStorage.setItem(AUTHOR_KEY, author.trim());
    } catch {
      // sem storage: só não lembra o nome
    }
    try {
      const n = await addDemandNote(demandId, text, author);
      if (n.syncError) setError(`Salvo no Vision, mas o War não recebeu: ${n.syncError}`);
      setText("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
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

  return (
    <section className="dd-section">
      <h3>
        Conversa <span className="dd-sub">{visible.length}</span>
      </h3>
      {visible.length === 0 ? (
        <p className="dd-hint">Nenhum comentário. O que for escrito aqui aparece nas notas da demanda no War.</p>
      ) : (
        <ul className="dd-notes">
          {visible.map((n) => (
            <li key={n.criadoEm} className={`dd-note ${n.origem === "vision" ? "mine" : ""}`}>
              <span className="dd-note-meta">
                <strong>{n.autor}</strong>
                {n.origem === "vision" ? " · Vision" : " · War"} · {fmtDateTime(n.criadoEm)}
              </span>
              {n.texto && <p>{n.texto}</p>}
              {n.imagens && n.imagens.length > 0 && (
                <span className="dd-note-imgs">
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
              {n.syncError && (
                <span className="dd-note-err">
                  não chegou ao War
                  <button className="sm ghost" onClick={() => resend(n.criadoEm)}>
                    <Icon name="refresh" size={12} />
                    Reenviar
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="dd-composer">
        {!readAuthor() && (
          <input
            className="dd-author"
            placeholder="Seu nome (aparece no War)"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
        )}
        <textarea
          rows={2}
          placeholder="Escreva para o gestor… (Ctrl+Enter envia)"
          value={text}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="dd-composer-bar">
          {readAuthor() && (
            <button className="sm ghost dd-author-change" title="Trocar nome" onClick={() => {
              try {
                localStorage.removeItem(AUTHOR_KEY);
              } catch {
                // ignora
              }
              setAuthor("");
            }}>
              como {author}
            </button>
          )}
          <button className="sm primary" disabled={!text.trim() || !author.trim() || sending} onClick={send}>
            {sending ? "Enviando…" : "Comentar"}
          </button>
        </div>
      </div>
      {error && <p className="note error">{error}</p>}
    </section>
  );
};

import React, { useState } from "react";
import { addDemandNote, resendDemandNote, type DemandNote } from "../api";
import { Icon } from "../editor/Icon";
import { useCurrentUser } from "../ui/user";
import { fmtDateTime, safeUrl } from "./demandUtil";

interface DemandNotesProps {
  demandId: string;
  notes: DemandNote[];
  onChanged: () => void;
}

/** Conversa da demanda: notas do War e do Vision na mesma linha do tempo */
export const DemandNotes: React.FC<DemandNotesProps> = ({ demandId, notes, onChanged }) => {
  const user = useCurrentUser();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = notes.filter((n) => !n.apagadoEm);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const n = await addDemandNote(demandId, text);
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
          <span className="dd-author-change">como {user?.name}</span>
          <button className="sm primary" disabled={!text.trim() || sending} onClick={send}>
            {sending ? "Enviando…" : "Comentar"}
          </button>
        </div>
      </div>
      {error && <p className="note error">{error}</p>}
    </section>
  );
};

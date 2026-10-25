import React, { useCallback, useState } from "react";
import { changePassword, logout } from "../api";
import { Icon } from "../editor/Icon";
import { useDismiss } from "../ui/controls";
import { useCurrentUser } from "../ui/user";

/** Nome de quem está logado, troca de senha e sair */
export const UserMenu: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setChanging(false);
    setMsg(null);
  }, []);
  const ref = useDismiss(open, close);
  if (!user) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await changePassword(current, next);
      setMsg({ ok: true, text: "Senha trocada." });
      setCurrent("");
      setNext("");
      setChanging(false);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="sm ghost user-btn" onClick={() => (open ? close() : setOpen(true))} title={user.email}>
        <Icon name="user" size={14} />
        {user.name}
      </button>
      {open && (
        <div className="popover user-pop">
          <div className="user-head">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          {changing ? (
            <form className="user-pass" onSubmit={save}>
              <input
                type="password"
                placeholder="Senha atual"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
              <input
                type="password"
                placeholder="Nova senha (mín. 10 caracteres)"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <button className="sm primary" disabled={!current || next.length < 10}>
                Salvar
              </button>
            </form>
          ) : (
            <button className="menu-item" onClick={() => setChanging(true)}>
              Trocar senha
            </button>
          )}
          {msg && <p className={`note ${msg.ok ? "" : "error"}`}>{msg.text}</p>}
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={async () => {
              await logout().catch(() => {});
              onLogout();
            }}
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
};

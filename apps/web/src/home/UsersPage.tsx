import React, { useEffect, useState } from "react";
import {
  createUser,
  listUsers,
  resetUserPassword,
  updateUser,
  type ManagedUser,
  type UserRole,
} from "../api";
import { Icon } from "../editor/Icon";
import { ConfirmButton } from "../ui/ConfirmButton";
import { Select } from "../ui/controls";
import { useCurrentUser } from "../ui/user";
import { fmtDateTime } from "./demandUtil";

const ROLE_LABEL: Record<UserRole, string> = {
  superadmin: "Super admin",
  admin: "Admin",
  editor: "Editor",
};

/** Senha gerada pelo servidor: aparece uma vez, com botão de copiar */
const PasswordReveal: React.FC<{ who: string; password: string; onClose: () => void }> = ({
  who,
  password,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="pw-reveal" role="status">
      <span>
        Senha de <strong>{who}</strong>. Anote ou envie agora: ela não aparece de novo.
      </span>
      <code>{password}</code>
      <button
        className="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(password).catch(() => {});
          setCopied(true);
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={13} />
        {copied ? "Copiada" : "Copiar"}
      </button>
      <button className="sm ghost" onClick={onClose}>
        Fechar
      </button>
    </div>
  );
};

export const UsersPage: React.FC = () => {
  const me = useCurrentUser();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ who: string; password: string } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "editor" as UserRole, password: "" });
  const [creating, setCreating] = useState(false);

  const load = () => listUsers().then(setUsers).catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  // superadmin dá qualquer papel; admin só cria e edita editores
  const assignable: UserRole[] = me?.role === "superadmin" ? ["editor", "admin", "superadmin"] : ["editor"];
  const canEdit = (u: ManagedUser) => me?.role === "superadmin" || u.role === "editor";

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    run(async () => {
      const r = await createUser(form);
      if (r.generatedPassword) setReveal({ who: r.user.name, password: r.generatedPassword });
      setForm({ name: "", email: "", role: "editor", password: "" });
    }).finally(() => setCreating(false));
  };

  return (
    <div className="page-pad users-page">
      <div className="board-bar">
        <h2>Usuários</h2>
        {users && <span className="board-count">{users.filter((u) => u.active).length}</span>}
      </div>

      {error && <p className="note error">{error}</p>}
      {reveal && <PasswordReveal {...reveal} onClose={() => setReveal(null)} />}

      <form className="user-form" onSubmit={create}>
        <h3 className="cl-h3">Novo acesso</h3>
        <div className="user-form-row">
          <input
            placeholder="Nome (aparece nas notas do War)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            type="email"
            placeholder="E-mail de login"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
            {assignable.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Senha (vazio = gerar uma)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <button className="primary" disabled={creating}>
            <Icon name="plus" size={14} />
            Criar
          </button>
        </div>
      </form>

      {users && (
        <table className="cl-table users-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Papel</th>
              <th>Último login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me?.id;
              const editable = canEdit(u);
              return (
                <tr key={u.id} className={u.active ? "" : "inactive"}>
                  <td className="cl-strong">
                    {u.name}
                    {self && <span className="you-tag">você</span>}
                    {!u.active && <span className="off-tag">desativado</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    {editable && !self ? (
                      <Select
                        className="role-select"
                        value={u.role}
                        onChange={(e) => run(() => updateUser(u.id, { role: e.target.value as UserRole }))}
                      >
                        {(assignable.includes(u.role) ? assignable : [u.role, ...assignable]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      ROLE_LABEL[u.role]
                    )}
                  </td>
                  <td>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "nunca"}</td>
                  <td className="users-actions">
                    {self && <span className="dd-hint">sua senha: menu com o seu nome → Trocar senha</span>}
                    {editable && !self && (
                      <>
                        <ConfirmButton
                          className="sm ghost"
                          title="Gera uma senha nova e derruba as sessões abertas desta pessoa"
                          question="Gerar senha nova?"
                          onConfirm={() =>
                            run(async () => {
                              const r = await resetUserPassword(u.id);
                              if (r.generatedPassword) setReveal({ who: u.name, password: r.generatedPassword });
                            })
                          }
                        >
                          Redefinir senha
                        </ConfirmButton>
                        {u.active ? (
                          <ConfirmButton
                            className="sm ghost danger"
                            title="A pessoa sai na hora e não entra mais"
                            question="Desativar?"
                            onConfirm={() => run(() => updateUser(u.id, { active: false }))}
                          >
                            Desativar
                          </ConfirmButton>
                        ) : (
                          <button className="sm ghost" onClick={() => run(() => updateUser(u.id, { active: true }))}>
                            Reativar
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

import crypto from "node:crypto";
import express from "express";
import { checkPasswordStrength, forgetSessions, hashPassword, toPublic } from "./auth";
import { getStore } from "./demands/store";
import type { User, UserRole } from "./demands/types";

/**
 * Tela de Usuários (só admin e superadmin).
 * - superadmin cria e edita qualquer acesso;
 * - admin cria e edita só editores;
 * - ninguém desativa a si mesmo nem muda o próprio papel;
 * - sempre sobra pelo menos um superadmin ativo.
 * Senha em branco = uma forte é gerada e devolvida uma única vez.
 */

const ROLES: UserRole[] = ["superadmin", "admin", "editor"];

export const usersRouter = express.Router();

type Handler = (req: express.Request, res: express.Response) => Promise<unknown>;
const wrap = (fn: Handler): express.RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const isManager = (role?: UserRole) => role === "superadmin" || role === "admin";

/** O que quem está logado pode fazer com um acesso de papel `role` */
function canManage(actor: Express.Request["user"], role: UserRole) {
  return actor?.role === "superadmin" || (actor?.role === "admin" && role === "editor");
}

function passwordOrGenerated(given: unknown): { password: string; generated: boolean } {
  const pw = typeof given === "string" ? given : "";
  if (!pw) return { password: crypto.randomBytes(12).toString("base64url"), generated: true };
  const weak = checkPasswordStrength(pw);
  if (weak) throw new HttpError(400, weak);
  return { password: pw, generated: false };
}

async function activeSuperadmins(except?: string) {
  return (await getStore().listUsers()).filter((u) => u.role === "superadmin" && u.active && u.id !== except).length;
}

usersRouter.use("/api/users", (req, res, next) => {
  if (!isManager(req.user?.role)) {
    res.status(403).json({ error: "só administradores gerenciam usuários" });
    return;
  }
  next();
});

usersRouter.get(
  "/api/users",
  wrap(async (_req, res) => {
    const order = (r: UserRole) => ROLES.indexOf(r);
    const users = (await getStore().listUsers())
      .map(toPublic)
      .sort((a, b) => Number(b.active) - Number(a.active) || order(a.role) - order(b.role) || a.name.localeCompare(b.name, "pt-BR"));
    res.json(users);
  })
);

usersRouter.post(
  "/api/users",
  wrap(async (req, res) => {
    const store = getStore();
    const name = String(req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const role = String(req.body?.role ?? "editor") as UserRole;
    if (!name) throw new HttpError(400, "informe o nome");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "e-mail inválido");
    if (!ROLES.includes(role)) throw new HttpError(400, "papel inválido");
    if (!canManage(req.user, role)) throw new HttpError(403, "você não pode criar esse tipo de acesso");
    if (await store.getUserByEmail(email)) throw new HttpError(409, `já existe um acesso com ${email}`);
    const { password, generated } = passwordOrGenerated(req.body?.password);
    const now = new Date().toISOString();
    const user: User = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: hashPassword(password),
      role,
      active: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await store.upsertUser(user);
    forgetSessions();
    res.json({ user: toPublic(user), generatedPassword: generated ? password : null });
  })
);

/** Nome, papel e ativo/inativo */
usersRouter.patch(
  "/api/users/:id",
  wrap(async (req, res) => {
    const store = getStore();
    const target = await store.getUser(String(req.params.id));
    if (!target) throw new HttpError(404, "acesso não encontrado");
    if (!canManage(req.user, target.role)) throw new HttpError(403, "você não pode alterar esse acesso");
    const self = target.id === req.user?.id;

    const next: User = { ...target, updatedAt: new Date().toISOString() };
    if (typeof req.body?.name === "string" && req.body.name.trim()) next.name = req.body.name.trim();
    if (req.body?.role !== undefined) {
      const role = String(req.body.role) as UserRole;
      if (!ROLES.includes(role)) throw new HttpError(400, "papel inválido");
      if (self && role !== target.role) throw new HttpError(400, "você não pode mudar o próprio papel");
      if (!canManage(req.user, role)) throw new HttpError(403, "você não pode dar esse papel");
      next.role = role;
    }
    if (typeof req.body?.active === "boolean") {
      if (self && !req.body.active) throw new HttpError(400, "você não pode desativar o próprio acesso");
      next.active = req.body.active;
    }
    if (target.role === "superadmin" && (next.role !== "superadmin" || !next.active) && (await activeSuperadmins(target.id)) === 0) {
      throw new HttpError(400, "precisa sobrar pelo menos um super admin ativo");
    }
    await store.upsertUser(next);
    forgetSessions();
    res.json(toPublic(next));
  })
);

/** Redefine a senha; as sessões abertas daquela pessoa caem */
usersRouter.post(
  "/api/users/:id/password",
  wrap(async (req, res) => {
    const store = getStore();
    const target = await store.getUser(String(req.params.id));
    if (!target) throw new HttpError(404, "acesso não encontrado");
    if (!canManage(req.user, target.role)) throw new HttpError(403, "você não pode alterar esse acesso");
    // redefinir derruba as sessões da pessoa: na própria conta, a tela cairia antes de mostrar a senha
    if (target.id === req.user?.id) throw new HttpError(400, "para a sua senha, use Trocar senha no menu com o seu nome");
    const { password, generated } = passwordOrGenerated(req.body?.password);
    await store.upsertUser({ ...target, passwordHash: hashPassword(password), updatedAt: new Date().toISOString() });
    forgetSessions();
    res.json({ generatedPassword: generated ? password : null });
  })
);

usersRouter.use("/api/users", ((err, _req, res, next) => {
  if (err instanceof HttpError) res.status(err.status).json({ error: err.message });
  else next(err);
}) as express.ErrorRequestHandler);

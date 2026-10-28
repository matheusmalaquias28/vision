import crypto from "node:crypto";
import express from "express";
import { getStore } from "./demands/store";
import type { User } from "./demands/types";

/**
 * Login próprio do Vision. Senhas com scrypt; sessão num cookie httpOnly
 * assinado (HMAC) com VISION_SESSION_SECRET, válido por 30 dias. Usuários
 * são criados pela CLI (`npm run cli -- user add`).
 */

const COOKIE = "vision_session";
const SESSION_DAYS = 30;

/** Usuário sem o hash da senha, como vai para o navegador */
export type PublicUser = Omit<User, "passwordHash">;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export const toPublic = ({ passwordHash: _, ...u }: User): PublicUser => u;

// ─── Senhas ──────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, saltHex, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const got = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(got, expected);
}

/** Mínimo para uma senha de acesso */
export function checkPasswordStrength(password: string): string | null {
  return password.length < 10 ? "a senha precisa ter pelo menos 10 caracteres" : null;
}

// ─── Sessão ──────────────────────────────────────────────────────────

let devSecret: string | null = null;

function sessionSecret(): string {
  const env = process.env.VISION_SESSION_SECRET;
  if (env && env.length >= 32) return env;
  if (!devSecret) {
    // sem segredo fixo as sessões caem a cada reinício: serve em dev, não em produção
    devSecret = crypto.randomBytes(32).toString("hex");
    console.warn("VISION_SESSION_SECRET ausente ou curto: usando um segredo temporário (sessões caem ao reiniciar)");
  }
  return devSecret;
}

const sign = (payload: string) => crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");

/** Muda quando a senha muda: sessões emitidas com a senha antiga deixam de valer */
const passwordVersion = (passwordHash: string) =>
  crypto.createHash("sha256").update(passwordHash).digest("base64url").slice(0, 12);

function createToken(user: User): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: user.id, pv: passwordVersion(user.passwordHash), exp: Date.now() + SESSION_DAYS * 86_400_000 })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string | undefined): { uid: string; pv: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const { uid, pv, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      uid: string;
      pv: string;
      exp: number;
    };
    return exp > Date.now() ? { uid, pv } : null;
  } catch {
    return null;
  }
}

function cookieFrom(req: express.Request): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function setCookie(req: express.Request, res: express.Response, value: string, maxAgeSec: number) {
  // atrás do Caddy o HTTPS chega como X-Forwarded-Proto
  const https = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${https ? "; Secure" : ""}`
  );
}

// ─── Proteção das rotas ──────────────────────────────────────────────

/** Rotas que não pedem login: o webhook do War tem segredo próprio */
const OPEN = new Set(["/api/auth/login", "/api/auth/logout", "/api/webhooks/war"]);

/**
 * Usuário lido do banco vale 30 s: o preview pede dezenas de pedaços de vídeo
 * e áudio por reprodução, e cada um esperava uma ida ao banco. Mudança de
 * usuário feita aqui limpa na hora (`forgetSessions`); pela CLI (outro
 * processo) leva até 30 s.
 */
const USER_TTL_MS = 30_000;
const userCache = new Map<string, { user: User | null; at: number }>();

export function forgetSessions() {
  userCache.clear();
}

async function sessionUser(uid: string): Promise<User | null> {
  const hit = userCache.get(uid);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.user;
  const user = await getStore().getUser(uid);
  userCache.set(uid, { user, at: Date.now() });
  return user;
}

/** Exige sessão válida em tudo (API e arquivos de media/), exceto OPEN */
export const requireAuth: express.RequestHandler = (req, res, next) => {
  if (OPEN.has(req.path)) return next();
  const token = readToken(cookieFrom(req));
  const fail = () => res.status(401).json({ error: "faça login para continuar" });
  if (!token) return fail();
  sessionUser(token.uid)
    .then((u) => {
      if (!u || !u.active || passwordVersion(u.passwordHash) !== token.pv) return fail();
      req.user = toPublic(u);
      next();
    })
    .catch(next);
};

// ─── Rotas ───────────────────────────────────────────────────────────

const attempts = new Map<string, { count: number; until: number }>();

/** 5 tentativas erradas por IP+e-mail bloqueiam por 10 minutos */
function tooManyAttempts(key: string): boolean {
  const a = attempts.get(key);
  return Boolean(a && a.count >= 5 && a.until > Date.now());
}
function registerFailure(key: string) {
  const a = attempts.get(key);
  const fresh = !a || a.until < Date.now();
  attempts.set(key, { count: fresh ? 1 : a.count + 1, until: Date.now() + 10 * 60_000 });
}

export const authRouter = express.Router();

authRouter.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const key = `${req.ip}|${email}`;
    if (tooManyAttempts(key)) {
      res.status(429).json({ error: "muitas tentativas; espere 10 minutos" });
      return;
    }
    const store = getStore();
    const user = email ? await store.getUserByEmail(email) : null;
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      registerFailure(key);
      res.status(401).json({ error: "e-mail ou senha incorretos" });
      return;
    }
    attempts.delete(key);
    const now = new Date().toISOString();
    await store.upsertUser({ ...user, lastLoginAt: now, updatedAt: now });
    setCookie(req, res, createToken(user), SESSION_DAYS * 86_400);
    res.json(toPublic(user));
  } catch (err) {
    next(err);
  }
});

authRouter.post("/api/auth/logout", (req, res) => {
  setCookie(req, res, "", 0);
  res.json({ ok: true });
});

authRouter.get("/api/auth/me", (req, res) => {
  res.json(req.user);
});

/** Troca da própria senha (precisa da atual) */
authRouter.post("/api/auth/password", async (req, res, next) => {
  try {
    const store = getStore();
    const user = req.user && (await store.getUser(req.user.id));
    if (!user || !verifyPassword(String(req.body?.current ?? ""), user.passwordHash)) {
      res.status(400).json({ error: "senha atual incorreta" });
      return;
    }
    const next_ = String(req.body?.next ?? "");
    const weak = checkPasswordStrength(next_);
    if (weak) {
      res.status(400).json({ error: weak });
      return;
    }
    const updated = { ...user, passwordHash: hashPassword(next_), updatedAt: new Date().toISOString() };
    await store.upsertUser(updated);
    forgetSessions();
    // outras sessões caem; esta continua com um cookie novo
    setCookie(req, res, createToken(updated), SESSION_DAYS * 86_400);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

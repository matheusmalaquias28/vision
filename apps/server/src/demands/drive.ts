import crypto from "node:crypto";
import fs from "node:fs";
import { getStore } from "./store";

/**
 * Google Drive pela conta da Scale (OAuth, conectada uma vez). Escopo "drive"
 * porque as pastas de entrega já existem e não foram criadas pelo Vision.
 * O refresh token fica em vision_settings["google_drive"].
 */

const SETTING = "google_drive";
const SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/userinfo.email"];

interface DriveSetting {
  refreshToken: string;
  email: string | null;
  connectedAt: string;
}

const clientId = () => process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET ?? "";
const publicUrl = () =>
  (
    process.env.VISION_PUBLIC_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:5173")
  ).replace(/\/$/, "");
const redirectUri = () => `${publicUrl()}/api/google/callback`;

export const driveConfigured = () => Boolean(clientId() && clientSecret());

const pendingStates = new Set<string>();

export function authUrl(): string {
  if (!driveConfigured()) throw new Error("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados");
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // força o refresh token mesmo se a conta já autorizou antes
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
  });
  const json = (await res.json()) as Record<string, string | number>;
  if (!res.ok) throw new Error(`Google OAuth: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

export async function handleCallback(code: string, state: string) {
  if (!pendingStates.delete(state)) throw new Error("login do Google expirado; tente conectar de novo");
  const tok = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!tok.refresh_token) throw new Error("o Google não devolveu refresh token");
  const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  }).then((r) => r.json() as Promise<{ email?: string }>);
  const setting: DriveSetting = {
    refreshToken: String(tok.refresh_token),
    email: me.email ?? null,
    connectedAt: new Date().toISOString(),
  };
  await getStore().setSetting(SETTING, setting);
  cached = null;
}

export async function driveStatus() {
  const s = await getStore().getSetting<DriveSetting>(SETTING);
  return { configured: driveConfigured(), connected: Boolean(s), email: s?.email ?? null };
}

export async function disconnect() {
  await getStore().deleteSetting(SETTING);
  cached = null;
}

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const s = await getStore().getSetting<DriveSetting>(SETTING);
  if (!s) throw new Error("Google Drive não conectado");
  const tok = await tokenRequest({ refresh_token: s.refreshToken, grant_type: "refresh_token" });
  cached = { token: String(tok.access_token), expires: Date.now() + Number(tok.expires_in) * 1000 };
  return cached.token;
}

/** Extrai o id da pasta de um link do Drive (…/folders/<id>, ?id=<id>) ou aceita o id puro */
export function folderIdFrom(link: string): string | null {
  const m = link.match(/\/folders\/([\w-]{10,})/) ?? link.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(link.trim()) ? link.trim() : null;
}

async function api(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Google Drive ${res.status}: ${body.error?.message ?? res.statusText}`);
  }
  return res;
}

/**
 * Envia o arquivo para a pasta. Se já existe um arquivo com o mesmo nome (um
 * re-render do mesmo vídeo), substitui o conteúdo em vez de duplicar.
 */
export async function uploadToFolder(folderLink: string, name: string, filePath: string) {
  const folderId = folderIdFrom(folderLink);
  if (!folderId) throw new Error(`link de pasta do Drive inválido: ${folderLink}`);
  const q = `name = '${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`;
  const found = (await (
    await api(
      `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({
        q,
        fields: "files(id)",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      })}`
    )
  ).json()) as { files: { id: string }[] };
  const existing = found.files[0]?.id;

  const data = fs.readFileSync(filePath);
  const base = "https://www.googleapis.com/upload/drive/v3/files";
  const start = await api(
    existing
      ? `${base}/${existing}?uploadType=resumable&supportsAllDrives=true`
      : `${base}?uploadType=resumable&supportsAllDrives=true`,
    {
      method: existing ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(data.length),
      },
      body: JSON.stringify(existing ? { name } : { name, parents: [folderId] }),
    }
  );
  const session = start.headers.get("location");
  if (!session) throw new Error("Google Drive não abriu a sessão de upload");
  const done = await api(session, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(data.length) },
    body: data,
  });
  const file = (await done.json()) as { id: string };
  return { id: file.id, url: `https://drive.google.com/file/d/${file.id}/view` };
}

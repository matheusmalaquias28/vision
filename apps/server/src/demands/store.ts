import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { repoRoot } from "../paths";
import type { Client, Demand, DemandEvent, DemandVideo, Notification, User } from "./types";

/**
 * Persistência de clientes/demandas. Com VISION_DATABASE_URL usa o Postgres
 * compartilhado, isolado no schema "vision" (db/vision.sql); sem ela, um JSON
 * local em data/ para desenvolvimento.
 */
export interface DemandStore {
  readonly kind: "postgres" | "local";
  listClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | null>;
  upsertClient(c: Client): Promise<void>;
  deleteClient(id: string): Promise<void>;
  listDemands(filter?: { clientId?: string }): Promise<Demand[]>;
  getDemand(id: string): Promise<Demand | null>;
  upsertDemand(d: Demand): Promise<void>;
  listVideos(demandId?: string): Promise<DemandVideo[]>;
  findVideoByProject(projectId: string): Promise<DemandVideo | null>;
  upsertVideo(v: DemandVideo): Promise<void>;
  listEvents(demandId: string): Promise<DemandEvent[]>;
  addEvent(e: Omit<DemandEvent, "id" | "createdAt">): Promise<DemandEvent>;
  listNotifications(limit: number): Promise<Notification[]>;
  addNotification(n: Omit<Notification, "id" | "createdAt" | "readAt">): Promise<void>;
  /** sem demandId marca todas */
  markNotificationsRead(demandId?: string): Promise<void>;
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  upsertUser(u: User): Promise<void>;
  getSetting<T>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;
  deleteSetting(key: string): Promise<void>;
}

// ─── Local (JSON) ────────────────────────────────────────────────────

interface LocalData {
  clients: Client[];
  demands: Demand[];
  videos: DemandVideo[];
  events: DemandEvent[];
  notifications?: Notification[];
  users?: User[];
  settings: Record<string, unknown>;
}

class LocalStore implements DemandStore {
  readonly kind = "local" as const;
  // fora de media/, que é servido como estático
  private file = path.join(repoRoot, "data", "demands-db.json");
  private cache: LocalData = { clients: [], demands: [], videos: [], events: [], settings: {} };
  private loadedMtime = -1;

  /** Relê o arquivo se outro processo (a CLI) o alterou */
  private get data(): LocalData {
    const mtime = fs.existsSync(this.file) ? fs.statSync(this.file).mtimeMs : -1;
    if (mtime !== this.loadedMtime) {
      if (mtime >= 0) this.cache = JSON.parse(fs.readFileSync(this.file, "utf8")) as LocalData;
      this.loadedMtime = mtime;
    }
    return this.cache;
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
    this.loadedMtime = fs.statSync(this.file).mtimeMs;
  }

  private put<T>(list: T[], item: T, same: (a: T) => boolean) {
    const i = list.findIndex(same);
    if (i >= 0) list[i] = item;
    else list.push(item);
    this.save();
  }

  async listClients() {
    return [...this.data.clients];
  }
  async getClient(id: string) {
    return this.data.clients.find((c) => c.id === id) ?? null;
  }
  async upsertClient(c: Client) {
    this.put(this.data.clients, c, (x) => x.id === c.id);
  }
  async deleteClient(id: string) {
    this.data.clients = this.data.clients.filter((c) => c.id !== id);
    this.save();
  }
  async listDemands(filter?: { clientId?: string }) {
    return this.data.demands.filter((d) => !filter?.clientId || d.clientId === filter.clientId);
  }
  async getDemand(id: string) {
    return this.data.demands.find((d) => d.id === id) ?? null;
  }
  async upsertDemand(d: Demand) {
    this.put(this.data.demands, d, (x) => x.id === d.id);
  }
  async listVideos(demandId?: string) {
    return this.data.videos
      .filter((v) => !demandId || v.demandId === demandId)
      .sort((a, b) => a.index - b.index);
  }
  async findVideoByProject(projectId: string) {
    return this.data.videos.find((v) => v.projectId === projectId) ?? null;
  }
  async upsertVideo(v: DemandVideo) {
    this.put(this.data.videos, v, (x) => x.demandId === v.demandId && x.index === v.index);
  }
  async listEvents(demandId: string) {
    return this.data.events.filter((e) => e.demandId === demandId);
  }
  async addEvent(e: Omit<DemandEvent, "id" | "createdAt">) {
    const event: DemandEvent = {
      ...e,
      id: (this.data.events.at(-1)?.id ?? 0) + 1,
      createdAt: new Date().toISOString(),
    };
    this.data.events.push(event);
    this.save();
    return event;
  }
  async listNotifications(limit: number) {
    return [...(this.data.notifications ?? [])].reverse().slice(0, limit);
  }
  async addNotification(n: Omit<Notification, "id" | "createdAt" | "readAt">) {
    const list = (this.data.notifications ??= []);
    list.push({ ...n, id: (list.at(-1)?.id ?? 0) + 1, readAt: null, createdAt: new Date().toISOString() });
    this.save();
  }
  async markNotificationsRead(demandId?: string) {
    const now = new Date().toISOString();
    for (const n of this.data.notifications ?? []) {
      if (!n.readAt && (!demandId || n.demandId === demandId)) n.readAt = now;
    }
    this.save();
  }
  async listUsers() {
    return [...(this.data.users ?? [])];
  }
  async getUser(id: string) {
    return (this.data.users ?? []).find((u) => u.id === id) ?? null;
  }
  async getUserByEmail(email: string) {
    return (this.data.users ?? []).find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async upsertUser(u: User) {
    this.put((this.data.users ??= []), u, (x) => x.id === u.id);
  }
  async getSetting<T>(key: string) {
    return (this.data.settings[key] as T | undefined) ?? null;
  }
  async setSetting(key: string, value: unknown) {
    this.data.settings[key] = value;
    this.save();
  }
  async deleteSetting(key: string) {
    delete this.data.settings[key];
    this.save();
  }
}

// ─── Postgres (schema vision) ────────────────────────────────────────

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Linha do pg → objeto do app: camelCase, datas em ISO, bigserial em número */
function fromRow<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      toCamel(k),
      v instanceof Date ? v.toISOString() : k === "id" && typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v,
    ])
  ) as T;
}

/** Objeto do app → colunas/valores; objetos e arrays viram jsonb */
function toColumns(obj: object) {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return {
    cols: entries.map(([k]) => `"${toSnake(k)}"`),
    values: entries.map(([, v]) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v)),
  };
}

/**
 * Acesso só ao schema "vision" (db/vision.sql), com o usuário vision_app.
 * Todo SQL usa nome qualificado vision.<tabela>: nada daqui alcança outro schema.
 */
class PgStore implements DemandStore {
  readonly kind = "postgres" as const;
  constructor(private pool: pg.Pool) {}

  private async rows<T>(sql: string, params: unknown[] = []) {
    const { rows } = await this.pool.query(sql, params);
    return rows.map((r) => fromRow<T>(r));
  }

  private async upsert(table: string, obj: object, keys: string[]) {
    const { cols, values } = toColumns(obj);
    const conflict = keys.map((k) => `"${k}"`);
    const updates = cols.filter((c) => !conflict.includes(c)).map((c) => `${c} = excluded.${c}`);
    await this.pool.query(
      `insert into vision.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       on conflict (${conflict.join(", ")}) do update set ${updates.join(", ")}`,
      values
    );
  }

  private async insert<T>(table: string, obj: object) {
    const { cols, values } = toColumns(obj);
    const [row] = await this.rows<T>(
      `insert into vision.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
      values
    );
    return row;
  }

  listClients() {
    return this.rows<Client>("select * from vision.clients");
  }
  async getClient(id: string) {
    return (await this.rows<Client>("select * from vision.clients where id = $1", [id]))[0] ?? null;
  }
  upsertClient(c: Client) {
    return this.upsert("clients", c, ["id"]);
  }
  async deleteClient(id: string) {
    await this.pool.query("delete from vision.clients where id = $1", [id]);
  }
  listDemands(filter?: { clientId?: string }) {
    return filter?.clientId
      ? this.rows<Demand>("select * from vision.demands where client_id = $1", [filter.clientId])
      : this.rows<Demand>("select * from vision.demands");
  }
  async getDemand(id: string) {
    return (await this.rows<Demand>("select * from vision.demands where id = $1", [id]))[0] ?? null;
  }
  upsertDemand(d: Demand) {
    return this.upsert("demands", d, ["id"]);
  }
  listVideos(demandId?: string) {
    return demandId
      ? this.rows<DemandVideo>("select * from vision.demand_videos where demand_id = $1 order by index", [demandId])
      : this.rows<DemandVideo>("select * from vision.demand_videos order by demand_id, index");
  }
  async findVideoByProject(projectId: string) {
    return (
      (await this.rows<DemandVideo>("select * from vision.demand_videos where project_id = $1", [projectId]))[0] ??
      null
    );
  }
  upsertVideo(v: DemandVideo) {
    return this.upsert("demand_videos", v, ["demand_id", "index"]);
  }
  listEvents(demandId: string) {
    return this.rows<DemandEvent>("select * from vision.demand_events where demand_id = $1 order by id", [demandId]);
  }
  addEvent(e: Omit<DemandEvent, "id" | "createdAt">) {
    return this.insert<DemandEvent>("demand_events", e);
  }
  listNotifications(limit: number) {
    return this.rows<Notification>("select * from vision.notifications order by id desc limit $1", [limit]);
  }
  async addNotification(n: Omit<Notification, "id" | "createdAt" | "readAt">) {
    await this.insert("notifications", n);
  }
  async markNotificationsRead(demandId?: string) {
    if (demandId) {
      await this.pool.query(
        "update vision.notifications set read_at = now() where read_at is null and demand_id = $1",
        [demandId]
      );
    } else {
      await this.pool.query("update vision.notifications set read_at = now() where read_at is null");
    }
  }
  listUsers() {
    return this.rows<User>("select * from vision.users order by name");
  }
  async getUser(id: string) {
    return (await this.rows<User>("select * from vision.users where id = $1", [id]))[0] ?? null;
  }
  async getUserByEmail(email: string) {
    return (await this.rows<User>("select * from vision.users where email = $1", [email.toLowerCase()]))[0] ?? null;
  }
  upsertUser(u: User) {
    return this.upsert("users", u, ["id"]);
  }
  async getSetting<T>(key: string) {
    const [row] = await this.rows<{ value: T }>("select value from vision.settings where key = $1", [key]);
    return row?.value ?? null;
  }
  setSetting(key: string, value: unknown) {
    return this.upsert("settings", { key, value, updatedAt: new Date().toISOString() }, ["key"]);
  }
  async deleteSetting(key: string) {
    await this.pool.query("delete from vision.settings where key = $1", [key]);
  }
}

let store: DemandStore | null = null;

export function getStore(): DemandStore {
  if (!store) {
    const url = process.env.VISION_DATABASE_URL;
    store = url
      ? new PgStore(
          new pg.Pool({
            connectionString: url,
            // banco compartilhado: poucas conexões, e só as do Vision
            max: Number(process.env.VISION_DB_POOL ?? 3),
            ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
            application_name: "vision",
          })
        )
      : new LocalStore();
    console.log(
      `Demandas: armazenamento ${store.kind === "postgres" ? "Postgres (schema vision)" : "local (data/demands-db.json)"}`
    );
  }
  return store;
}

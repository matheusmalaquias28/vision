/** Cliente do War. id = clientId do War, ou "nome:<slug>" sem cadastro */
export interface Client {
  id: string;
  warClientId: string | null;
  name: string;
  instagram: string | null;
  drive: string | null;
  squad: string | null;
  gestor: string | null;
  raw: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Nota/comentário da demanda. criadoEm é a identidade da nota nos dois lados (War e Vision). */
export interface DemandNote {
  texto: string;
  autor: string;
  criadoEm: string;
  imagens?: string[];
  editadoEm?: string;
  apagadoEm?: string;
  /** de onde veio: notas do War nunca voltam ao War */
  origem?: "war" | "vision";
  /** nota do Vision que o War ainda não confirmou */
  syncError?: string | null;
}

export interface Notification {
  id: number;
  demandId: string;
  kind: "demand" | "note";
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Demand {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  priority: string | null;
  videoCount: number;
  driveEditados: string | null;
  driveMateriais: string | null;
  briefing: string;
  briefingText: string | null;
  instagram: string | null;
  gestor: string | null;
  solicitante: string | null;
  /** "webdesigner" do War: exibido, não filtra nada */
  editor: string | null;
  squad: string | null;
  categoria: string | null;
  status: string;
  dueDate: string | null;
  notas: DemandNote[];
  statusPermitidos: string[];
  callbackUrl: string | null;
  warCreatedAt: string | null;
  warUpdatedAt: string | null;
  statusChangedAt: string | null;
  /** devolução do último status ao War */
  syncState: "ok" | "error";
  syncError: string | null;
  raw: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface DemandVideo {
  demandId: string;
  /** 1..videoCount */
  index: number;
  projectId: string | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  deliveredAt: string | null;
  updatedAt: string;
}

export interface DemandEvent {
  id: number;
  demandId: string;
  direction: "in" | "out";
  kind: "created" | "updated" | "status" | "note";
  status: string | null;
  previousStatus: string | null;
  by: string | null;
  payload: unknown;
  ok: boolean;
  error: string | null;
  attempts: number;
  createdAt: string;
}

/** Status canônicos de vídeo no War (sem "Fazendo", que a UI de vídeo esconde) */
export const WAR_VIDEO_STATUSES = [
  "Aguardando Definição de Data",
  "Em Fila",
  "Aprovação do Gestor",
  "Aprovado",
  "Aprovação do Cliente",
  "Ajuste",
  "Atrasado",
  "Aprovação de Copy",
  "Concluído",
];

export type UserRole = "superadmin" | "admin" | "editor";

/** Pessoa que entra no Vision (login próprio, schema vision; nada do auth do Supabase) */
export interface User {
  id: string;
  name: string;
  /** sempre minúsculo */
  email: string;
  /** scrypt$<sal>$<hash> */
  passwordHash: string;
  /** superadmin gerencia todos; admin gerencia editores; editor só usa */
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

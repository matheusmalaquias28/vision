import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import multer from "multer";
import { mediaKindOf, uploadProblem, UPLOAD_LIMITS, type MediaKind, type Recipe } from "@vision/recipe";
import { probeDuration } from "./pipeline/probe";
import { createProject, slugify } from "./project";

export const upload = multer({
  dest: path.join(os.tmpdir(), "vision-uploads"),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

/** Arquivos que entram na timeline (clipe, overlay, música, efeito): limite do maior tipo */
export const clipUpload = multer({
  dest: path.join(os.tmpdir(), "vision-uploads"),
  limits: { fileSize: Math.max(...Object.values(UPLOAD_LIMITS).map((l) => l.maxBytes)) },
});

/**
 * Confere tipo, tamanho e duração de um arquivo da timeline (mesmos limites
 * do editor). Recusado: apaga o temporário e devolve o motivo.
 */
export async function checkClipUpload(
  file: Express.Multer.File,
  allowed: MediaKind[]
): Promise<{ kind: MediaKind; seconds: number | null } | { error: string }> {
  const kind = mediaKindOf(file.originalname, file.mimetype);
  const reject = (error: string) => {
    fs.rmSync(file.path, { force: true });
    return { error };
  };
  if (!kind || !allowed.includes(kind)) return reject(`tipo de arquivo não aceito aqui (${path.extname(file.originalname) || file.mimetype})`);
  const seconds = kind === "image" ? null : await probeDuration(file.path).catch(() => null);
  const problem = uploadProblem(kind, file.size, seconds);
  return problem ? reject(problem) : { kind, seconds };
}

/**
 * O multer entrega o nome do arquivo decodificado como latin1: "vídeo.mp4"
 * chega "vÃ­deo.mp4". Reinterpreta como UTF-8 quando isso dá um texto válido.
 */
export function uploadName(raw: string): string {
  const utf8 = Buffer.from(raw, "latin1").toString("utf8");
  return utf8.includes("�") ? raw : utf8;
}

/** Cria o projeto a partir dos arquivos do multer e apaga os temporários */
export async function createProjectFromUploads(
  files: Express.Multer.File[],
  requestedId: string | undefined,
  briefing: string
): Promise<Recipe> {
  if (files.length === 0) throw new Error("envie ao menos um arquivo no campo 'videos'");
  const renamed: string[] = [];
  try {
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase() || ".mp4";
      const withExt = `${f.path}${ext}`;
      fs.renameSync(f.path, withExt);
      renamed.push(withExt);
    }
    const names = files.map((f) => uploadName(f.originalname));
    const id = requestedId || slugify(path.basename(names[0], path.extname(names[0])));
    return await createProject(renamed, id, briefing, names);
  } finally {
    for (const p of renamed) fs.rmSync(p, { force: true });
  }
}

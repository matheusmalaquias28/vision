import { mediaKindOf, uploadProblem, type MediaKind } from "@vision/recipe";

/**
 * Duração de um arquivo local lida pelo navegador, antes de enviar (null se o
 * navegador não souber abrir, ex. HEVC/ProRes: o servidor confere depois).
 */
export function probeFileDuration(file: File, kind: MediaKind): Promise<number | null> {
  if (kind === "image") return Promise.resolve(null);
  return new Promise((resolve) => {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const done = (v: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 6000);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

/** Tipo, duração e motivo de recusa (limites de `UPLOAD_LIMITS`) de um arquivo do computador */
export async function inspectMediaFile(file: File): Promise<{ kind: MediaKind; seconds: number | null } | { error: string }> {
  const kind = mediaKindOf(file.name, file.type);
  if (!kind) return { error: `${file.name}: tipo de arquivo não aceito (use vídeo, áudio ou imagem)` };
  // tamanho primeiro: não abre um arquivo gigante só para saber a duração
  const heavy = uploadProblem(kind, file.size, null);
  if (heavy) return { error: `${file.name}: ${heavy}` };
  const seconds = await probeFileDuration(file, kind);
  const problem = uploadProblem(kind, file.size, seconds);
  return problem ? { error: `${file.name}: ${problem}` } : { kind, seconds };
}

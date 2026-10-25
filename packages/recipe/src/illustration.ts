/**
 * Ilustração gerada por IA de imagem (Magnific · Nano Banana Pro Flash): a IA
 * do planner só descreve O QUE desenhar a partir de um ponto-chave da fala;
 * o estilo (colagem de papel, halftone, marca-texto) é fixo aqui, igual em
 * todo vídeo. Sempre 1:1 em 1K (cartão quadrado sobre o vídeo vertical).
 */

/** No máximo 3 por vídeo (custo e respiro), bem espaçadas */
export const MAX_ILLUSTRATIONS = 3;
export const ILLUSTRATION_GAP_SECONDS = 8;
export const ILLUSTRATION_ASPECT = "1:1";
export const ILLUSTRATION_RESOLUTION = "1K";
/** Muda quando o estilo muda: imagens antigas não são reaproveitadas pelo cache */
export const ILLUSTRATION_STYLE_VERSION = 1;

const STYLE = [
  "Vintage paper collage illustration for a short documentary-style video.",
  "A single central subject printed as a black-and-white halftone photograph, cut out and glued on aged off-white paper,",
  "torn paper edges, visible paper fibers and grain, soft shadows of overlapping paper scraps,",
  "muted sepia and charcoal tones with ONE accent of bright yellow highlighter marker (a hand-drawn circle or underline around the key element).",
  "Editorial, symbolic, slightly retro, clean composition with breathing room around the subject.",
  "Not photorealistic. No text, no letters, no numbers, no words, no logos, no watermarks, no borders, no UI.",
  "Screens, documents and signs are blank or show only simple abstract shapes or icons, never writing.",
  "People, if any, appear only as anonymous halftone figures or hands, never recognizable faces.",
].join(" ");

/** Prompt final enviado à API: estilo fixo + o assunto escolhido pela IA/operador */
export function illustrationPrompt(subject: string): string {
  const s = subject.replace(/\s+/g, " ").trim();
  return `${STYLE}\nSubject (may be in Portuguese): ${s}`;
}

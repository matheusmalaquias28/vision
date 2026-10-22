import fs from "node:fs";
import path from "node:path";
import { outputDuration, type AudioClip, type Recipe } from "@vision/recipe";
import { musicDir } from "./paths";

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

export const TEMPLATES: TemplateInfo[] = [
  {
    id: "clean",
    name: "Clean",
    description: "Legenda branca discreta, sem efeitos. Conteúdo institucional.",
  },
  {
    id: "dinamico",
    name: "Dinâmico",
    description:
      "Punch-in nos cortes, legenda grande com contorno forte e destaque amarelo, SFX de transição (se houver em media/sfx).",
  },
  {
    id: "podcast",
    name: "Podcast",
    description: "Legenda média no terço inferior, sem punch-in, música bem baixa.",
  },
];

/** Nomes de arquivo em media/sfx que valem como som de transição */
const TRANSITION_SFX = ["whoosh.mp3", "swoosh.mp3", "transition.mp3", "swish.mp3"];

function findTransitionSfx(): string | null {
  const sfxDir = path.join(musicDir, "..", "sfx");
  if (!fs.existsSync(sfxDir)) return null;
  const files = fs.readdirSync(sfxDir).map((f) => f.toLowerCase());
  for (const candidate of TRANSITION_SFX) {
    if (files.includes(candidate)) return `media/sfx/${candidate}`;
  }
  return null;
}

/** SFX de transição em cada troca de segmento (menos o início do vídeo) */
function sfxAtCuts(recipe: Recipe): AudioClip[] {
  const file = findTransitionSfx();
  if (!file) return [];
  const cuts: AudioClip[] = [];
  let acc = 0;
  recipe.timeline.segments.forEach((s, i) => {
    if (i > 0) {
      cuts.push({
        id: `sfx_${String(cuts.length + 1).padStart(2, "0")}`,
        kind: "sfx",
        file,
        start: Math.round(acc * 100) / 100,
        duration: 1.5,
        offset: 0,
        volume: 0.5,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        loop: false,
        mediaDurationSeconds: null,
        assetId: null,
      });
    }
    acc += s.sourceEnd - s.sourceStart;
  });
  return cuts;
}

export function applyTemplate(recipe: Recipe, templateId: string): Recipe {
  const style = recipe.captions.style;
  switch (templateId) {
    case "clean":
      return {
        ...recipe,
        template: templateId,
        effects: { ...recipe.effects, punchIn: false },
        audioClips: recipe.audioClips.filter((c) => c.kind !== "sfx"),
        captions: {
          ...recipe.captions,
          style: {
            ...style,
            fontFamily: "Inter",
            fontSizePx: 52,
            textColor: "#FFFFFF",
            highlightColor: "#FFFFFF",
            strokeWidthPx: 6,
            uppercase: false,
            animation: "none",
          },
        },
      };
    case "dinamico":
      return {
        ...recipe,
        template: templateId,
        effects: { ...recipe.effects, punchIn: true },
        audioClips: [...recipe.audioClips.filter((c) => c.kind !== "sfx"), ...sfxAtCuts(recipe)],
        captions: {
          ...recipe.captions,
          style: {
            ...style,
            fontFamily: "Archivo Black",
            fontSizePx: 72,
            textColor: "#FFFFFF",
            highlightColor: "#FFD700",
            strokeWidthPx: 16,
            uppercase: true,
            animation: "pop",
          },
        },
      };
    case "podcast":
      return {
        ...recipe,
        template: templateId,
        effects: { ...recipe.effects, punchIn: false },
        captions: {
          ...recipe.captions,
          style: {
            ...style,
            fontFamily: "Montserrat",
            fontSizePx: 54,
            highlightColor: "#7CFC9B",
            strokeWidthPx: 10,
            uppercase: true,
            animation: "pop",
          },
        },
        audioClips: recipe.audioClips.map((c) => (c.kind === "music" ? { ...c, volume: 0.06 } : c)),
      };
    default:
      throw new Error(`Template desconhecido: ${templateId}`);
  }
}

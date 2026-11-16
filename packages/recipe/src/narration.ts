/**
 * Narração por texto (TTS), gerada à mão na aba Narração do editor. O
 * provedor (hoje OpenAI `gpt-4o-mini-tts`) fica no servidor; aqui só o que o
 * editor e o servidor combinam: vozes oferecidas, tons prontos e limites.
 */

export interface NarrationVoice {
  id: string;
  label: string;
  description: string;
}

/** Vozes oferecidas no painel (id = voz do provedor) */
export const NARRATION_VOICES: NarrationVoice[] = [
  { id: "marin", label: "Marin", description: "feminina, natural e próxima" },
  { id: "cedar", label: "Cedar", description: "masculina, natural e próxima" },
  { id: "coral", label: "Coral", description: "feminina, calorosa" },
  { id: "nova", label: "Nova", description: "feminina, jovem e animada" },
  { id: "onyx", label: "Onyx", description: "masculina, grave" },
  { id: "ash", label: "Ash", description: "masculina, clara e firme" },
];

export const DEFAULT_NARRATION_VOICE = "marin";

/** Tons prontos: viram a direção de fala mandada ao modelo */
export const NARRATION_TONES: { id: string; label: string; instructions: string }[] = [
  {
    id: "natural",
    label: "Natural",
    instructions: "Fale em português do Brasil, natural e conversado, como alguém explicando algo a um amigo.",
  },
  {
    id: "animado",
    label: "Animado (reels)",
    instructions:
      "Fale em português do Brasil com energia alta e ritmo rápido de vídeo curto para redes sociais, enfatizando as palavras-chave.",
  },
  {
    id: "calmo",
    label: "Calmo",
    instructions: "Fale em português do Brasil com calma, voz suave e pausas tranquilas entre as frases.",
  },
  {
    id: "serio",
    label: "Sério",
    instructions: "Fale em português do Brasil com tom sério e confiante, como um apresentador de notícias.",
  },
];

/** Velocidade da fala (1 = a do modelo); aplicada depois no ffmpeg (atempo) */
export const NARRATION_SPEED_MIN = 0.8;
export const NARRATION_SPEED_MAX = 1.3;

/** Teto do roteiro (o provedor aceita ~4096 caracteres; vídeo vai até 3 min) */
export const NARRATION_MAX_CHARS = 4000;

export interface NarrationRequest {
  script: string;
  voice: string;
  /** Direção de fala (tom); "" = sem direção */
  instructions: string;
  speed: number;
}

/** Resultado da geração: arquivo pronto para ouvir e, se o editor quiser, pôr na timeline */
export interface NarrationTake {
  file: string;
  durationSeconds: number;
}

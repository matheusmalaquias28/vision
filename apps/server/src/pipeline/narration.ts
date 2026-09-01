import fs from "node:fs";
import path from "node:path";
import { groupWordsIntoBlocks, type Recipe } from "@vision/recipe";
import { projectDir, toRecipePath } from "../paths";
import {
  extractCompressedAudio,
  requireOpenAI,
  transcribeAudioFile,
} from "./transcribe";

/**
 * Gera narração TTS a partir de um roteiro, transcreve o resultado para
 * obter timestamps por palavra e adiciona os blocos de legenda em tempo
 * do vídeo final (sourceId null).
 */
export async function generateNarration(
  recipe: Recipe,
  script: string,
  voice = "onyx",
  withCaptions = true
): Promise<Recipe> {
  const client = requireOpenAI();
  const speech = await client.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: script,
  });
  const dir = projectDir(recipe.projectId);
  const narrationAbs = path.join(dir, "narration.mp3");
  fs.writeFileSync(narrationAbs, Buffer.from(await speech.arrayBuffer()));

  let updated: Recipe = {
    ...recipe,
    audio: {
      ...recipe.audio,
      narration: {
        file: toRecipePath(narrationAbs),
        volume: 1,
        offsetSeconds: 0,
      },
      // narração vira a voz principal; fala original vira ambiente
      originalVolume: Math.min(recipe.audio.originalVolume, 0.2),
    },
  };

  if (withCaptions) {
    const compressed = await extractCompressedAudio(
      narrationAbs,
      path.join(dir, "narration-whisper.m4a")
    );
    const words = await transcribeAudioFile(compressed);
    if (words.length > 0) {
      const newBlocks = groupWordsIntoBlocks(
        words,
        recipe.captions.style.maxWordsPerBlock,
        undefined,
        null // tempo do vídeo final
      );
      const blocks = [...updated.captions.blocks, ...newBlocks].map((b, i) => ({
        ...b,
        id: `cap_${String(i + 1).padStart(2, "0")}`,
      }));
      updated = { ...updated, captions: { ...updated.captions, blocks } };
    }
  }
  return updated;
}

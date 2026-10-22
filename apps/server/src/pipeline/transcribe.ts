import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import {
  groupWordsIntoBlocks,
  spreadCollapsedWords,
  type CaptionBlock,
  type Recipe,
  type Word,
} from "@vision/recipe";
import { fromRecipePath, projectDir } from "../paths";
import { ffmpegPath, runOrThrow } from "./ffbin";
import { refineTranscriptTimings } from "./silence";

const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export async function extractCompressedAudio(
  videoOrAudioAbsPath: string,
  outAbsPath: string
): Promise<string> {
  await runOrThrow(ffmpegPath, [
    "-y",
    "-i", videoOrAudioAbsPath,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "aac",
    "-b:a", "64k",
    outAbsPath,
  ]);
  const size = fs.statSync(outAbsPath).size;
  if (size > WHISPER_MAX_BYTES) {
    throw new Error(
      `Áudio extraído tem ${(size / 1024 / 1024).toFixed(1)} MB, acima do limite de 25 MB do Whisper`
    );
  }
  return outAbsPath;
}

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export function requireOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY não definida. Preencha .env.local ou .env na raiz."
    );
  }
  return new OpenAI();
}

/** Transcreve um arquivo de áudio; retorna [] se não houver fala */
export async function transcribeAudioFile(audioPath: string): Promise<Word[]> {
  const client = requireOpenAI();
  const response = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
    // o Whisper "limpa" hesitações por padrão; um prompt com disfluências
    // faz ele transcrevê-las — e aí viram sugestões de corte de vício
    prompt: "Ééé... então, tipo, hum, deixa eu ver... ahn, né? Eh, o que eu ia dizer.",
  });
  const rawWords = (response as unknown as { words?: WhisperWord[] }).words;
  if (!rawWords) return [];
  return spreadCollapsedWords(
    rawWords
      .map((w) => ({
        text: w.word.trim(),
        start: Math.round(w.start * 1000) / 1000,
        end: Math.round(Math.max(w.end, w.start) * 1000) / 1000,
      }))
      .filter((w) => w.text.length > 0)
  );
}

/** Transcreve todas as fontes e grava os blocos (com sourceId) na receita */
export async function transcribeProject(recipe: Recipe): Promise<Recipe> {
  const dir = projectDir(recipe.projectId);
  const allBlocks: CaptionBlock[] = [];
  for (const source of recipe.sources) {
    const audioPath = await extractCompressedAudio(
      fromRecipePath(source.file),
      path.join(dir, `audio-${source.id}.m4a`)
    );
    const words = await transcribeAudioFile(audioPath);
    allBlocks.push(
      ...groupWordsIntoBlocks(
        words,
        recipe.captions.style.maxWordsPerBlock,
        undefined,
        source.id
      )
    );
  }
  if (allBlocks.length === 0) {
    throw new Error("Whisper não retornou palavras em nenhum clipe (sem fala?)");
  }
  const blocks = allBlocks.map((b, i) => ({
    ...b,
    id: `cap_${String(i + 1).padStart(2, "0")}`,
  }));
  // tempos das palavras ajustados aos silêncios reais (legenda em sincronia
  // e pausas visíveis para a sugestão de cortes)
  return refineTranscriptTimings({ ...recipe, captions: { ...recipe.captions, blocks } });
}

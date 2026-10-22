import { describe, expect, it } from "vitest";
import { createAudioClip, duplicateAudioClip, splitAudioClip } from "../src/audioClips";
import { AudioClipSchema, type AudioClip } from "../src/schema";

function clip(patch: Partial<AudioClip> = {}): AudioClip {
  return AudioClipSchema.parse({
    id: "aud_1",
    kind: "music",
    file: "media/music/a.mp3",
    start: 2,
    duration: 10,
    offset: 5,
    fadeInSeconds: 1,
    fadeOutSeconds: 2,
    ...patch,
  });
}

describe("splitAudioClip", () => {
  it("divide no instante e o segundo pedaço continua o arquivo", () => {
    const [a, b] = splitAudioClip(clip(), 6, "aud_2")!;
    expect(a).toMatchObject({ id: "aud_1", start: 2, duration: 4, offset: 5, fadeInSeconds: 1, fadeOutSeconds: 0 });
    expect(b).toMatchObject({ id: "aud_2", start: 6, duration: 6, offset: 9, fadeInSeconds: 0, fadeOutSeconds: 2 });
  });

  it("com loop, o offset dá a volta no trecho repetido", () => {
    // trecho repetido = [5, 8] (3s); depois de 7s tocados → 7 % 3 = 1 → 6
    const [, b] = splitAudioClip(clip({ loop: true, mediaDurationSeconds: 8 }), 9, "aud_2")!;
    expect(b.offset).toBe(6);
  });

  it("recusa ponto fora do clipe ou colado na borda", () => {
    expect(splitAudioClip(clip(), 1, "x")).toBeNull();
    expect(splitAudioClip(clip(), 2.05, "x")).toBeNull();
    expect(splitAudioClip(clip(), 12, "x")).toBeNull();
  });
});

describe("duplicateAudioClip", () => {
  it("cola a cópia logo depois do original", () => {
    expect(duplicateAudioClip(clip(), "aud_2")).toMatchObject({ id: "aud_2", start: 12, duration: 10, offset: 5 });
  });
});

describe("createAudioClip", () => {
  it("música curta termina com o arquivo; sem duração conhecida vai em loop até o fim", () => {
    const short = createAudioClip({ id: "a", kind: "music", file: "m.mp3", start: 5, videoDuration: 60, mediaDurationSeconds: 20 });
    expect(short).toMatchObject({ start: 5, duration: 20, loop: false, volume: 0.12 });
    const unknown = createAudioClip({ id: "b", kind: "music", file: "m.mp3", start: 5, videoDuration: 60 });
    expect(unknown).toMatchObject({ duration: 55, loop: true });
  });

  it("sfx usa a duração do arquivo e não passa do fim do vídeo", () => {
    expect(createAudioClip({ id: "c", kind: "sfx", file: "s.wav", start: 59, videoDuration: 60, mediaDurationSeconds: 3 }))
      .toMatchObject({ start: 59, duration: 1, volume: 0.8, loop: false });
  });
});

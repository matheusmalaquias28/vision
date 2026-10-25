import { describe, expect, it } from "vitest";
import {
  acceptAudioClip,
  defaultMusicWant,
  MusicProfileSchema,
  MusicWantSchema,
  rankMusic,
  suggestMusicClip,
  swapMusicClip,
  tempoFromBpm,
  type MusicProfile,
  type MusicWant,
} from "../src/music";
import { AudioClipSchema, CaptionStyleSchema, type AudioClip } from "../src/schema";

const track = (id: string, p: Partial<MusicProfile> | null, durationSeconds = 120) => ({
  id,
  name: id,
  file: `media/library/p/music/${id}.m4a`,
  durationSeconds,
  music: p === null ? null : MusicProfileSchema.parse({ energy: 3, tempo: "medio", ...p }),
});

describe("escolha de música", () => {
  const lib = [
    track("lofi", { moods: ["calma", "relaxante"], energy: 2, tempo: "lento", genre: "lofi" }),
    track("hype", { moods: ["animada", "motivacional"], energy: 5, tempo: "rapido", genre: "eletrônica" }),
    track("pop-cantado", { moods: ["animada", "alegre"], energy: 4, tempo: "rapido", genre: "pop", vocals: "lead" }),
    track("corporativa", { moods: ["motivacional"], energy: 3, tempo: "medio", genre: "corporativa", useFor: ["institucional"] }),
    track("sem-perfil", null),
  ];

  it("ranqueia pelo que o vídeo pede; voz cantada perde quando há fala; sem perfil fica de fora", () => {
    const hype = rankMusic(lib, MusicWantSchema.parse({ moods: ["animada"], energy: 5, tempo: "rapido" }));
    expect(hype[0].asset.id).toBe("hype");
    expect(hype.map((r) => r.asset.id)).not.toContain("sem-perfil");
    // o pop cantado combina no humor, mas a voz compete com a fala
    expect(hype.findIndex((r) => r.asset.id === "pop-cantado")).toBeGreaterThan(0);
    const calm = rankMusic(lib, MusicWantSchema.parse({ moods: ["calma"], energy: 2, tempo: "lento", genre: "lofi" }));
    expect(calm[0].asset.id).toBe("lofi");
    expect(calm[0].why).toMatch(/energia 2\/5/);
    expect(rankMusic(lib, defaultMusicWant(), { exclude: ["hype"] }).map((r) => r.asset.id)).not.toContain("hype");
  });

  it("andamento pela medição (hip hop a ~90 conta como médio)", () => {
    expect(tempoFromBpm(76)).toBe("lento");
    expect(tempoFromBpm(92)).toBe("medio");
    expect(tempoFromBpm(128)).toBe("rapido");
    expect(tempoFromBpm(null)).toBe("medio");
  });

  it("trilha entra como sugestão pendente do começo ao fim (loop se curta); troca, aceita; trilha do operador não é tocada", () => {
    const base: { audioClips: AudioClip[]; musicWant: MusicWant | null } = { audioClips: [], musicWant: null };
    const ranked = rankMusic(lib, defaultMusicWant());
    const r1 = suggestMusicClip(base, ranked[0], defaultMusicWant(), 45);
    const clip = r1.audioClips[0];
    expect(clip).toMatchObject({ kind: "music", status: "pending", origin: "ai", start: 0, duration: 45, volume: 0.12 });
    expect(clip.note).toBe(ranked[0].why);
    expect(r1.musicWant).toEqual(defaultMusicWant());
    const short = suggestMusicClip(base, { ...ranked[0], asset: { ...ranked[0].asset, durationSeconds: 20 } }, defaultMusicWant(), 45);
    expect(short.audioClips[0].loop).toBe(true);
    // nova sugestão substitui a anterior pendente
    const r2 = suggestMusicClip(r1, ranked[1], defaultMusicWant(), 45);
    expect(r2.audioClips).toHaveLength(1);
    expect(r2.audioClips[0].assetId).toBe(ranked[1].asset.id);
    const swapped = swapMusicClip(r2, clip.id, ranked[2]);
    expect(swapped.audioClips[0]).toMatchObject({ assetId: ranked[2].asset.id, duration: 45, status: "pending" });
    const accepted = acceptAudioClip(swapped, clip.id);
    expect(accepted.audioClips[0].status).toBe("accepted");
    // depois de aceita (ou trilha posta à mão), a IA não troca
    expect(suggestMusicClip(accepted, ranked[3], defaultMusicWant(), 45).audioClips[0].assetId).toBe(ranked[2].asset.id);
  });

  it("clipes antigos continuam valendo (aceitos, manuais); legenda aceita os modelos novos", () => {
    const old = AudioClipSchema.parse({ id: "a", kind: "music", file: "media/music/x.mp3", start: 0, duration: 5 });
    expect(old).toMatchObject({ status: "accepted", origin: "manual", note: "" });
    for (const animation of ["pop", "none", "smooth", "reveal", "box", "blur"]) {
      expect(CaptionStyleSchema.parse({ animation }).animation).toBe(animation);
    }
    expect(CaptionStyleSchema.parse({}).animation).toBe("pop");
  });
});

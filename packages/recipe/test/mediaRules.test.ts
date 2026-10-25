import { describe, expect, it } from "vitest";
import { dropTarget, libraryDropTarget, mediaKindOf, SFX_MAX_SECONDS, uploadProblem, UPLOAD_LIMITS } from "../src/mediaRules";

const MB = 1024 * 1024;

describe("regras das camadas", () => {
  it("áudio nunca cai em trilha de vídeo ou texto", () => {
    for (const lane of ["video", "captions", "motions", "overlays", "videoAudio", null] as const) {
      expect(dropTarget("audio", lane, 3)).toBe("sfx");
      expect(dropTarget("audio", lane, 90)).toBe("music");
    }
    // solto direto numa trilha de áudio: respeita a escolha
    expect(dropTarget("audio", "music", 2)).toBe("music");
    expect(dropTarget("audio", "sfx", 120)).toBe("sfx");
    expect(dropTarget("audio", null, SFX_MAX_SECONDS)).toBe("sfx");
    expect(dropTarget("audio", null, null)).toBe("sfx");
  });

  it("vídeo vira clipe da sequência (som na trilha do vídeo) ou overlay sem som; imagem só overlay", () => {
    expect(dropTarget("video", "video", 10)).toBe("video");
    expect(dropTarget("video", "music", 10)).toBe("video");
    expect(dropTarget("video", "sfx", 10)).toBe("video");
    expect(dropTarget("video", "overlays", 10)).toBe("overlays");
    expect(dropTarget("image", "music", null)).toBe("overlays");
    expect(dropTarget("image", "video", null)).toBe("overlays");
  });

  it("itens da biblioteca seguem a mesma regra", () => {
    expect(libraryDropTarget("sfx")).toBe("sfx");
    expect(libraryDropTarget("music")).toBe("music");
    expect(libraryDropTarget("icon")).toBe("overlays");
  });
});

describe("limites de arquivo", () => {
  it("reconhece o tipo pelo MIME ou pela extensão", () => {
    expect(mediaKindOf("x.bin", "video/mp4")).toBe("video");
    expect(mediaKindOf("Clipe.MOV")).toBe("video");
    expect(mediaKindOf("voz.m4a")).toBe("audio");
    expect(mediaKindOf("logo.PNG")).toBe("image");
    expect(mediaKindOf("planilha.xlsx")).toBeNull();
  });

  it("recusa longo ou pesado com motivo; duração desconhecida passa pelo tamanho", () => {
    expect(uploadProblem("video", 50 * MB, 30)).toBeNull();
    expect(uploadProblem("video", 400 * MB, 30)).toMatch(/pesado.*300 MB/);
    expect(uploadProblem("video", 50 * MB, 95)).toMatch(/longo \(1:35 min\).*1:00 min/);
    expect(uploadProblem("audio", 10 * MB, 400)).toMatch(/longo/);
    expect(uploadProblem("audio", 10 * MB, null)).toBeNull();
    expect(uploadProblem("image", 25 * MB, null)).toMatch(/20 MB/);
    expect(UPLOAD_LIMITS.video.maxSeconds).toBe(60);
  });
});

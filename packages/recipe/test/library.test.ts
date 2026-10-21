import { describe, expect, it } from "vitest";
import { AssetSchema, CatalogSchema, searchAssets, type Asset } from "../src/library";

const asset = (over: Partial<Asset>): Asset =>
  AssetSchema.parse({
    id: "a",
    type: "sfx",
    name: "x",
    file: "media/library/p/sfx/a.wav",
    pack: "p",
    source: "a.wav",
    sourceSize: 1,
    sourceMtimeMs: 1,
    ...over,
  });

const assets = [
  asset({ id: "boom", name: "BOOM 01", collection: "BOOM CINEMATIC", tags: ["impacto", "grave"] }),
  asset({ id: "whoosh", name: "fast woosh 1", tags: ["transição", "movimento"] }),
  asset({ id: "money", type: "icon", name: "Ícone 3", description: "Saco de dinheiro; use ao falar de lucro", tags: ["dinheiro"] }),
];

describe("searchAssets", () => {
  it("busca em nome, coleção, tags e descrição, ignorando acento e caixa", () => {
    expect(searchAssets(assets, "TRANSICAO").map((a) => a.id)).toEqual(["whoosh"]);
    expect(searchAssets(assets, "cinematic").map((a) => a.id)).toEqual(["boom"]);
    expect(searchAssets(assets, "lucro").map((a) => a.id)).toEqual(["money"]);
  });

  it("todos os termos precisam bater", () => {
    expect(searchAssets(assets, "impacto grave").map((a) => a.id)).toEqual(["boom"]);
    expect(searchAssets(assets, "impacto dinheiro")).toEqual([]);
  });

  it("filtra por tipo; busca vazia lista o tipo inteiro", () => {
    expect(searchAssets(assets, "", ["icon"]).map((a) => a.id)).toEqual(["money"]);
    expect(searchAssets(assets, "")).toHaveLength(3);
  });
});

describe("CatalogSchema", () => {
  it("aplica defaults e rejeita tipo desconhecido", () => {
    const c = CatalogSchema.parse({ version: 1 });
    expect(c.assets).toEqual([]);
    expect(() => asset({ type: "mogrt" as never })).toThrow();
  });
});

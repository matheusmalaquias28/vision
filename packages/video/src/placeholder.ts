import type { Recipe } from "@vision/recipe";

/** Receita mínima usada apenas como defaultProps da composição */
export const placeholderRecipe: Recipe = {
  version: 2,
  projectId: "placeholder",
  createdAt: "2026-01-01T00:00:00.000Z",
  briefing: "",
  template: null,
  sources: [
    {
      id: "src_01",
      file: "media/projects/placeholder/source.mp4",
      name: "",
      durationInSeconds: 1,
      width: 1080,
      height: 1920,
      fps: 30,
      enhancedAudio: null,
    },
  ],
  timeline: {
    segments: [
      { id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 1 },
    ],
    suggestedCuts: [],
  },
  overlays: [],
  audioClips: [],
  layerOrder: ["captions", "motions", "overlays", "video"],
  motions: [],
  effects: { punchIn: false },
  captions: {
    style: {
      preset: "capcut-bold",
      fontFamily: "Archivo Black",
      fontSizePx: 64,
      fontWeight: 900,
      placement: null,
      textColor: "#FFFFFF",
      highlightColor: "#FFD700",
      position: "bottom-third",
      maxWordsPerBlock: 4,
      uppercase: true,
      wordsPerLine: 0,
      maxWidthPct: 85,
      strokeWidthPx: 12,
      strokeColor: "#000000",
      animation: "pop",
      autoFit: true,
    },
    blocks: [],
  },
  audio: { originalVolume: 1, useEnhanced: false, narration: null },
  render: { width: 1080, height: 1920, fps: 30, codec: "h264" },
};

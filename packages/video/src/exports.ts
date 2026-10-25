// Entrada para consumidores (web player, server) — NÃO registra o root.
// O entry do bundle do Remotion é o index.ts.
export { VisionComposition, type VisionCompositionProps } from "./VisionComposition";
export { RemotionRoot, COMPOSITION_ID, recipeMetadata } from "./Root";
export { placeholderRecipe } from "./placeholder";
export { LAB_DEMOS, LAB_FPS, MotionLabComposition, type LabDemo, type LabDemoId, type LabWord, type MotionLabProps } from "./lab/MotionLab";
export { DRAG_ATTR } from "./Positioned";
export { MotionPreviewComposition, type MotionPreviewProps, type PreviewPiece } from "./MotionPreview";

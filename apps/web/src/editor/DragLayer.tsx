import type { PlayerRef } from "@remotion/player";
import {
  canResize,
  getPlacement,
  MOTION_LABEL,
  resizeTarget,
  setPlacement,
  type Point,
  type Recipe,
} from "@vision/recipe";
import { DRAG_ATTR } from "@vision/video";
import React, { useEffect, useRef, useState } from "react";

/** Distância (% do quadro) em que o centro do elemento gruda no meio do vídeo */
const SNAP_PCT = 1.5;

interface Box {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragLayerProps {
  recipe: Recipe;
  playerRef: React.RefObject<PlayerRef | null>;
  /** Alvo selecionado no editor ("caption", "overlay:<id>", "motion:<id>") */
  selected: string | null;
  onChange: (recipe: Recipe) => void;
  onSelect: (target: string) => void;
}

function label(recipe: Recipe, id: string): string {
  if (id === "caption") return "Legenda";
  const [kind, key] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
  if (kind === "motion") {
    const m = recipe.motions.find((x) => x.id === key);
    return m ? MOTION_LABEL[m.kind] : "Motion";
  }
  const o = recipe.overlays.find((x) => x.id === key);
  return o?.kind === "title" ? "Texto" : "Overlay";
}

/**
 * Camada sobre o preview: acha no DOM do Player os elementos marcados com
 * data-vision-drag e desenha uma alça em cada um. Arrastar grava a posição
 * livre (centro em % do quadro); duplo clique volta à posição padrão.
 * Fica fora do Player (irmã do quadro): clique fora das alças continua
 * tocando/pausando o vídeo.
 */
export const DragLayer: React.FC<DragLayerProps> = ({ recipe, playerRef, selected, onChange, onSelect }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameRect | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [guides, setGuides] = useState({ x: false, y: false });
  const [dragging, setDragging] = useState<string | null>(null);
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;

  // mede a cada quadro de animação: os elementos se mexem enquanto o vídeo toca
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const layer = layerRef.current;
      const frameEl = layer?.parentElement?.querySelector<HTMLElement>(".viewer-frame");
      if (!layer || !frameEl) return;
      const base = layer.getBoundingClientRect();
      const fr = frameEl.getBoundingClientRect();
      const seen = new Set<string>();
      const found: Box[] = [];
      frameEl.querySelectorAll<HTMLElement>(`[${DRAG_ATTR}]`).forEach((el) => {
        const id = el.getAttribute(DRAG_ATTR);
        // premount do Remotion deixa cópias invisíveis no DOM
        if (!id || seen.has(id) || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
        // só a parte dentro do quadro: um sticker meio para fora não pode
        // cobrir (e roubar o clique de) painéis vizinhos
        const r = el.getBoundingClientRect();
        const left = Math.max(r.left, fr.left);
        const top = Math.max(r.top, fr.top);
        const width = Math.min(r.right, fr.right) - left;
        const height = Math.min(r.bottom, fr.bottom) - top;
        if (width < 2 || height < 2) return;
        seen.add(id);
        found.push({ id, left: left - base.left, top: top - base.top, width, height });
      });
      // menores por cima: uma legenda dentro da área de um sticker continua pegável
      found.sort((a, b) => b.width * b.height - a.width * a.height);
      const nextFrame = { left: fr.left - base.left, top: fr.top - base.top, width: fr.width, height: fr.height };
      const key = JSON.stringify([nextFrame, found]);
      if (key !== last) {
        last = key;
        setFrame(nextFrame);
        setBoxes(found);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const startDrag = (e: React.PointerEvent, box: Box) => {
    if (e.button !== 0 || !frame) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(box.id);
    playerRef.current?.pause();
    // ponto de partida: onde o elemento está agora (padrão ou já arrastado)
    const start: Point = getPlacement(recipeRef.current, box.id) ?? {
      x: ((box.left + box.width / 2 - frame.left) / frame.width) * 100,
      y: ((box.top + box.height / 2 - frame.top) / frame.height) * 100,
    };
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    setDragging(box.id);
    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / frame.width) * 100;
      const dy = ((ev.clientY - startY) / frame.height) * 100;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
      moved = true;
      let x = start.x + dx;
      let y = start.y + dy;
      // Shift trava o eixo de maior movimento
      if (ev.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) y = start.y;
        else x = start.x;
      }
      const snapX = Math.abs(x - 50) < SNAP_PCT;
      const snapY = Math.abs(y - 50) < SNAP_PCT;
      if (snapX) x = 50;
      if (snapY) y = 50;
      setGuides({ x: snapX, y: snapY });
      onChange(setPlacement(recipeRef.current, box.id, { x, y }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGuides({ x: false, y: false });
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /**
   * Alça do canto: o tamanho acompanha a distância do ponteiro ao centro do
   * elemento (fonte da legenda/texto, largura do sticker, size do motion).
   */
  const startResize = (e: React.PointerEvent, box: Box) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(box.id);
    playerRef.current?.pause();
    const base = recipeRef.current;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const layer = layerRef.current!.getBoundingClientRect();
    const dist = (x: number, y: number) => Math.max(8, Math.hypot(x - layer.left - cx, y - layer.top - cy));
    const d0 = dist(e.clientX, e.clientY);
    setDragging(box.id);
    const onMove = (ev: PointerEvent) => onChange(resizeTarget(base, box.id, dist(ev.clientX, ev.clientY) / d0));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div ref={layerRef} className={`drag-layer ${dragging ? "dragging" : ""}`}>
      {frame && guides.x && (
        <div className="drag-guide v" style={{ left: frame.left + frame.width / 2, top: frame.top, height: frame.height }} />
      )}
      {frame && guides.y && (
        <div className="drag-guide h" style={{ top: frame.top + frame.height / 2, left: frame.left, width: frame.width }} />
      )}
      {boxes.map((b) => {
        const free = getPlacement(recipe, b.id) !== null;
        return (
          <div
            key={b.id}
            className={`drag-box ${selected === b.id || dragging === b.id ? "selected" : ""}`}
            style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
            title="Arraste para posicionar · Shift trava o eixo · duplo clique volta à posição padrão"
            onPointerDown={(e) => startDrag(e, b)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (free) onChange(setPlacement(recipeRef.current, b.id, null));
            }}
          >
            <span className="drag-tag">
              {label(recipe, b.id)}
              {free ? " · livre" : ""}
            </span>
            {(selected === b.id || dragging === b.id) && canResize(recipe, b.id) && (
              <span
                className="drag-resize"
                title="Arraste para mudar o tamanho"
                onPointerDown={(e) => startResize(e, b)}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

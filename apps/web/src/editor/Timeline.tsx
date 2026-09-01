import {
  applyAcceptedCut,
  outputDuration,
  sourceToOutput,
  type Recipe,
  type Segment,
  type SuggestedCut,
} from "@vision/recipe";
import React, { useEffect, useRef, useState } from "react";
import type { ProjectWaveforms, WaveformData } from "../api";

const MIN_SEGMENT = 0.1;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Posição de um bloco de legenda no vídeo final (null = trecho cortado) */
function blockOutputStart(
  segments: Segment[],
  sourceId: string | null,
  start: number
): number | null {
  return sourceId === null ? start : sourceToOutput(segments, sourceId, start);
}

const WaveCanvas: React.FC<{
  waveform: WaveformData;
  sourceStart: number;
  sourceEnd: number;
  width: number;
  height: number;
}> = ({ waveform, sourceStart, sourceEnd, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = Math.max(Math.floor(width), 1);
    canvas.width = w;
    canvas.height = height;
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = "rgba(190, 215, 255, 0.6)";
    // normaliza pelo pico máximo do clipe (o mais alto ocupa a altura toda)
    const maxPeak = Math.max(...waveform.peaks, 0.01);
    const gain = Math.min(1 / maxPeak, 25);
    const firstBin = sourceStart * waveform.binsPerSecond;
    const binSpan = (sourceEnd - sourceStart) * waveform.binsPerSecond;
    const mid = height / 2;
    for (let x = 0; x < w; x++) {
      const bin = Math.floor(firstBin + (x / w) * binSpan);
      const peak = Math.min((waveform.peaks[bin] ?? 0) * gain, 1);
      const barHalf = Math.max(Math.pow(peak, 0.7) * (mid - 1), 0.5);
      ctx.fillRect(x, mid - barHalf, 1, barHalf * 2);
    }
  }, [waveform, sourceStart, sourceEnd, width, height]);
  return <canvas ref={ref} className="wave-canvas" style={{ height }} />;
};

interface TimelineProps {
  recipe: Recipe;
  waveforms: ProjectWaveforms | null;
  playheadSeconds: number;
  selectedCaption: string | null;
  selectedOverlay: string | null;
  onChange: (recipe: Recipe) => void;
  onSeek: (seconds: number) => void;
  onSelectCaption: (id: string | null) => void;
  onSelectOverlay: (id: string | null) => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  recipe,
  waveforms,
  playheadSeconds,
  selectedCaption,
  selectedOverlay,
  onChange,
  onSeek,
  onSelectCaption,
  onSelectOverlay,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const segments = recipe.timeline.segments;
  const duration = Math.max(outputDuration(segments), 0.001);
  const pxPerSec = width / duration;
  const multiClip = recipe.sources.length > 1;

  const setSegments = (next: Segment[]) =>
    onChange({ ...recipe, timeline: { ...recipe.timeline, segments: next } });

  const startEdgeDrag = (
    e: React.PointerEvent,
    index: number,
    edge: "start" | "end"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const orig = segments.map((s) => ({ ...s }));
    const sourceDur =
      recipe.sources.find((s) => s.id === orig[index].sourceId)
        ?.durationInSeconds ?? Infinity;
    const onMove = (ev: PointerEvent) => {
      const deltaSec = (ev.clientX - startX) / pxPerSec;
      const next = orig.map((s) => ({ ...s }));
      const seg = next[index];
      if (edge === "start") {
        seg.sourceStart = round2(
          clamp(orig[index].sourceStart + deltaSec, 0, seg.sourceEnd - MIN_SEGMENT)
        );
      } else {
        seg.sourceEnd = round2(
          clamp(orig[index].sourceEnd + deltaSec, seg.sourceStart + MIN_SEGMENT, sourceDur)
        );
      }
      setSegments(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const moveSegment = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= segments.length) return;
    const next = [...segments];
    [next[index], next[target]] = [next[target], next[index]];
    setSegments(next);
  };

  const reviewSuggestion = (cut: SuggestedCut, accept: boolean) => {
    const status = accept ? ("accepted" as const) : ("rejected" as const);
    onChange({
      ...recipe,
      timeline: {
        segments: accept ? applyAcceptedCut(segments, cut) : segments,
        suggestedCuts: recipe.timeline.suggestedCuts.map((c) =>
          c.id === cut.id ? { ...c, status } : c
        ),
      },
    });
  };

  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek(clamp((e.clientX - rect.left) / pxPerSec, 0, duration));
  };

  let cursor = 0;
  const segmentPositions = segments.map((s) => {
    const left = cursor;
    cursor += s.sourceEnd - s.sourceStart;
    return left;
  });

  const pendingCuts = recipe.timeline.suggestedCuts.filter(
    (c) => c.status === "pending"
  );

  return (
    <div className="timeline" ref={containerRef} onClick={seekFromEvent}>
      <div className="ruler">
        {Array.from({ length: Math.floor(duration) + 1 }, (_, i) => (
          <span key={i} className="tick" style={{ left: i * pxPerSec }}>
            {i}s
          </span>
        ))}
      </div>

      <div className="track track-video">
        <span className="track-label">Vídeo</span>
        {segments.map((seg, i) => (
          <div
            key={seg.id}
            className="segment"
            style={{
              left: segmentPositions[i] * pxPerSec,
              width: (seg.sourceEnd - seg.sourceStart) * pxPerSec,
            }}
            title={`${seg.sourceId} · ${seg.sourceStart.toFixed(2)}s → ${seg.sourceEnd.toFixed(2)}s (bruto)`}
          >
            {waveforms?.[seg.sourceId] && (
              <WaveCanvas
                waveform={waveforms[seg.sourceId]}
                sourceStart={seg.sourceStart}
                sourceEnd={seg.sourceEnd}
                width={(seg.sourceEnd - seg.sourceStart) * pxPerSec}
                height={52}
              />
            )}
            <div
              className="handle handle-l"
              onPointerDown={(e) => startEdgeDrag(e, i, "start")}
            />
            <span className="segment-label">
              {multiClip ? seg.sourceId : seg.id}
            </span>
            {multiClip && (
              <span className="segment-move" onClick={(e) => e.stopPropagation()}>
                <button title="Mover para a esquerda" onClick={() => moveSegment(i, -1)}>
                  ‹
                </button>
                <button title="Mover para a direita" onClick={() => moveSegment(i, 1)}>
                  ›
                </button>
              </span>
            )}
            <div
              className="handle handle-r"
              onPointerDown={(e) => startEdgeDrag(e, i, "end")}
            />
          </div>
        ))}
        {pendingCuts.map((cut) => {
          const outStart = sourceToOutput(segments, cut.sourceId, cut.sourceStart);
          if (outStart === null) return null;
          return (
            <div
              key={cut.id}
              className="suggestion"
              style={{
                left: outStart * pxPerSec,
                width: Math.max((cut.sourceEnd - cut.sourceStart) * pxPerSec, 24),
              }}
              title={`Silêncio sugerido (confiança ${cut.confidence})`}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="ok" onClick={() => reviewSuggestion(cut, true)}>
                ✓
              </button>
              <button className="no" onClick={() => reviewSuggestion(cut, false)}>
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="track track-caption">
        <span className="track-label">Legenda</span>
        {recipe.captions.blocks.map((block) => {
          const start = blockOutputStart(segments, block.sourceId, block.words[0].start);
          if (start === null) return null;
          const endRaw = blockOutputStart(
            segments,
            block.sourceId,
            block.words[block.words.length - 1].end - 0.01
          );
          const end = endRaw ?? start + 0.3;
          return (
            <div
              key={block.id}
              className={`caption-block ${selectedCaption === block.id ? "selected" : ""} ${block.sourceId === null ? "narration-block" : ""}`}
              style={{
                left: start * pxPerSec,
                width: Math.max((end - start) * pxPerSec, 16),
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectCaption(block.id === selectedCaption ? null : block.id);
              }}
              title={block.words.map((w) => w.text).join(" ")}
            >
              {block.words.map((w) => w.text).join(" ")}
            </div>
          );
        })}
      </div>

      <div className="track track-overlay">
        <span className="track-label">Overlays</span>
        {recipe.overlays.map((o) => {
          const end = o.end ?? duration;
          return (
            <div
              key={o.id}
              className={`overlay-block ${selectedOverlay === o.id ? "selected" : ""}`}
              style={{
                left: o.start * pxPerSec,
                width: Math.max((end - o.start) * pxPerSec, 16),
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectOverlay(o.id === selectedOverlay ? null : o.id);
              }}
              title={o.kind === "title" ? o.text : (o.file ?? "")}
            >
              {o.kind === "title" ? `T: ${o.text}` : `${o.kind}: ${o.file?.split("/").pop()}`}
            </div>
          );
        })}
      </div>

      <div className="track track-audio">
        <span className="track-label">Áudio</span>
        {recipe.audio.music ? (
          <div className="music-bar" style={{ left: 0, width: duration * pxPerSec }}>
            ♪ {recipe.audio.music.file.split("/").pop()} · vol{" "}
            {Math.round(recipe.audio.music.volume * 100)}%
            {recipe.audio.narration ? " · + narração" : ""}
            {recipe.audio.useEnhanced ? " · áudio tratado" : ""}
          </div>
        ) : (
          <div className="music-bar empty-bar">
            {recipe.audio.narration ? "narração" : "sem música"}
            {recipe.audio.useEnhanced ? " · áudio tratado" : ""}
          </div>
        )}
        {recipe.sfx.map((s) => (
          <div
            key={s.id}
            className="sfx-marker"
            style={{ left: s.at * pxPerSec }}
            title={`${s.file.split("/").pop()} @ ${s.at.toFixed(2)}s`}
          />
        ))}
      </div>

      <div
        className="playhead"
        style={{ left: clamp(playheadSeconds, 0, duration) * pxPerSec }}
      />
    </div>
  );
};

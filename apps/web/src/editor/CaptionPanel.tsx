import type { CaptionBlock, Recipe, SourceTime, Word } from "@vision/recipe";
import React, { useEffect, useState } from "react";
import { Prop, ScrubNumber, Section } from "../ui/controls";
import { Icon } from "./Icon";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Redistribui o timing do bloco entre novas palavras, proporcional ao
 * tamanho de cada palavra — usado quando o texto é reescrito e o número
 * de palavras muda.
 */
function retimeWords(newTexts: string[], blockStart: number, blockEnd: number): Word[] {
  const totalChars = newTexts.reduce((acc, t) => acc + Math.max(t.length, 1), 0);
  const duration = Math.max(blockEnd - blockStart, 0.1);
  let cursor = blockStart;
  return newTexts.map((text) => {
    const slice = (Math.max(text.length, 1) / totalChars) * duration;
    const word: Word = {
      text,
      start: round2(cursor),
      end: round2(Math.min(cursor + slice, blockEnd)),
    };
    cursor += slice;
    return word;
  });
}

interface CaptionPanelProps {
  recipe: Recipe;
  selectedId: string | null;
  /** Playhead no tempo do vídeo final */
  playheadOutputSeconds: number;
  /** Playhead mapeado para o clipe bruto sob ele (null = fora da timeline) */
  playheadSource: SourceTime | null;
  onChange: (recipe: Recipe) => void;
  onSelect: (id: string | null) => void;
}

export const CaptionPanel: React.FC<CaptionPanelProps> = ({
  recipe,
  selectedId,
  playheadOutputSeconds,
  playheadSource,
  onChange,
  onSelect,
}) => {
  const blocks = recipe.captions.blocks;
  const index = blocks.findIndex((b) => b.id === selectedId);
  const block = index >= 0 ? blocks[index] : undefined;
  const [text, setText] = useState("");

  useEffect(() => {
    setText(block ? block.words.map((w) => w.text).join(" ") : "");
  }, [selectedId, block]);

  const replaceBlock = (updated: CaptionBlock) => {
    onChange({
      ...recipe,
      captions: {
        ...recipe.captions,
        blocks: blocks.map((b) => (b.id === updated.id ? updated : b)),
      },
    });
  };

  const commitText = () => {
    if (!block) return;
    const newTexts = text.trim().split(/\s+/).filter(Boolean);
    if (newTexts.length === 0) return removeBlock();
    const sameCount = newTexts.length === block.words.length;
    const words = sameCount
      ? block.words.map((w, i) => ({ ...w, text: newTexts[i] }))
      : retimeWords(newTexts, block.words[0].start, block.words[block.words.length - 1].end);
    replaceBlock({ ...block, words });
  };

  const shiftBlock = (deltaSeconds: number) => {
    if (!block) return;
    const minStart = block.words[0].start;
    const delta = Math.max(deltaSeconds, -minStart);
    replaceBlock({
      ...block,
      words: block.words.map((w) => ({
        ...w,
        start: round2(w.start + delta),
        end: round2(w.end + delta),
      })),
    });
  };

  // alvo do "início no playhead": blocos de narração usam o tempo do vídeo
  // final; blocos de fala precisam do playhead sobre o MESMO clipe
  const snapTarget = !block
    ? null
    : block.sourceId === null
      ? playheadOutputSeconds
      : playheadSource !== null && playheadSource.sourceId === block.sourceId
        ? playheadSource.seconds
        : null;

  const snapToPlayhead = () => {
    if (!block || snapTarget === null) return;
    shiftBlock(snapTarget - block.words[0].start);
  };

  const updateWord = (wordIndex: number, patch: Partial<{ text: string; start: number; end: number }>) => {
    if (!block) return;
    replaceBlock({
      ...block,
      words: block.words.map((w, i) => (i === wordIndex ? { ...w, ...patch } : w)),
    });
  };

  const removeWord = (wordIndex: number) => {
    if (!block) return;
    const words = block.words.filter((_, i) => i !== wordIndex);
    if (words.length === 0) return removeBlock();
    replaceBlock({ ...block, words });
  };

  const removeBlock = () => {
    if (!block) return;
    onChange({
      ...recipe,
      captions: { ...recipe.captions, blocks: blocks.filter((b) => b.id !== block.id) },
    });
    onSelect(null);
  };

  const nav = (delta: number) => {
    if (blocks.length === 0) return;
    const next = index < 0 ? 0 : (index + delta + blocks.length) % blocks.length;
    onSelect(blocks[next].id);
  };

  return (
    <Section
      title={block ? `Bloco ${index + 1} de ${blocks.length}` : "Bloco de legenda"}
      actions={
        blocks.length > 0 && (
          <>
            <button className="sm icon ghost" title="Bloco anterior" onClick={() => nav(-1)}>
              <Icon name="chevronLeft" size={14} />
            </button>
            <button className="sm icon ghost" title="Próximo bloco" onClick={() => nav(1)}>
              <Icon name="chevronRight" size={14} />
            </button>
          </>
        )
      }
    >
      {!block ? (
        <p className="empty-hint">
          {blocks.length === 0
            ? "Sem legendas ainda. Transcrever gera os blocos automaticamente."
            : "Clique num bloco roxo na timeline, ou use as setas acima."}
        </p>
      ) : (
        <>
          <input
            className="block-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <Prop label="Tempo">
            <span className="timing">
              {block.words[0].start.toFixed(2)}s → {block.words[block.words.length - 1].end.toFixed(2)}s
              {block.sourceId === null ? " · narração" : ""}
            </span>
          </Prop>
          <Prop label="Deslocar">
            <button className="sm" title="Adiantar 0.1s" onClick={() => shiftBlock(-0.1)}>
              <Icon name="rewind" size={12} /> 0.1s
            </button>
            <button className="sm" title="Atrasar 0.1s" onClick={() => shiftBlock(0.1)}>
              0.1s <Icon name="forward" size={12} />
            </button>
            <button
              className="sm"
              title="Move o bloco para começar onde o playhead está (precisa estar sobre o mesmo clipe)"
              disabled={snapTarget === null}
              onClick={snapToPlayhead}
            >
              <Icon name="anchor" size={12} /> Playhead
            </button>
          </Prop>
          <details className="fine-tune">
            <summary className="link-btn">Ajuste fino por palavra</summary>
            <div className="word-table">
              {block.words.map((word, i) => (
                <div key={i} className="word-row">
                  <input value={word.text} onChange={(e) => updateWord(i, { text: e.target.value })} />
                  <ScrubNumber
                    value={word.start}
                    min={0}
                    step={0.01}
                    pxPerStep={3}
                    onChange={(v) => updateWord(i, { start: v })}
                  />
                  <ScrubNumber
                    value={word.end}
                    min={0}
                    step={0.01}
                    pxPerStep={3}
                    onChange={(v) => updateWord(i, { end: v })}
                  />
                  <button className="sm icon ghost" title="Remover palavra" onClick={() => removeWord(i)}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
            </div>
          </details>
          <div className="row row-end">
            <button className="sm danger" onClick={removeBlock}>
              <Icon name="trash" size={13} /> Remover bloco
            </button>
          </div>
        </>
      )}
    </Section>
  );
};

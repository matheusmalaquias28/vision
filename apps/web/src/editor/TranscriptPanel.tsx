import {
  applyCutToSegments,
  CUT_REASON_LABEL,
  CUT_REASONS,
  MOTION_LABEL,
  isWordKept,
  restoreSourceRange,
  reviewSuggestions,
  sourceToOutput,
  transcriptWords,
  wordMid,
  wordsBySource,
  wordsCutRange,
  wordsRestoreRange,
  type CutReason,
  type Recipe,
  type Segment,
  type SourceTime,
  type SuggestedCut,
  type TranscriptWord,
} from "@vision/recipe";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "../ui/controls";
import { Icon } from "./Icon";

/** Quanto tempo depois do início a palavra continua "sob o playhead" (s) */
const ACTIVE_WORD_HOLD = 1.5;

interface Selection {
  anchor: number;
  focus: number;
}

interface TranscriptPanelProps {
  recipe: Recipe;
  /** Playhead mapeado para o clipe bruto sob ele (null = fora da timeline) */
  playheadSource: SourceTime | null;
  onChange: (recipe: Recipe) => void;
  onSeek: (outputSeconds: number) => void;
  /** Cabeçalho do dock (abas); sem ele usa o título padrão */
  head?: React.ReactNode;
}

/**
 * Editor por texto: apagar palavras corta o vídeo, clicar numa palavra
 * riscada e apagar de novo restaura. Sugestões pendentes aparecem inline,
 * com aceitar/rejeitar no próprio texto.
 */
export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  recipe,
  playheadSource,
  onChange,
  onSeek,
  head,
}) => {
  const segments = recipe.timeline.segments;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dragging = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => {
    const words = transcriptWords(recipe);
    const lists = wordsBySource(words);
    // words já vem agrupado por fonte na mesma ordem das listas
    const seen = new Map<string, number>();
    const posInSource = words.map((w) => {
      const n = seen.get(w.sourceId) ?? 0;
      seen.set(w.sourceId, n + 1);
      return n;
    });
    const kept = words.map((w) => isWordKept(segments, w));
    const pending = recipe.timeline.suggestedCuts.filter((c) => c.status === "pending");
    // sugestão que cobre cada palavra + onde o chip de cada sugestão aparece
    const wordSug: (SuggestedCut | undefined)[] = words.map((w) =>
      pending.find(
        (c) =>
          c.sourceId === w.sourceId &&
          wordMid(w) >= c.sourceStart &&
          wordMid(w) <= c.sourceEnd
      )
    );
    const chipsBefore = new Map<number, SuggestedCut[]>();
    const chipsAfterSource = new Map<string, SuggestedCut[]>();
    for (const c of pending) {
      const i = words.findIndex(
        (w) => w.sourceId === c.sourceId && wordMid(w) >= c.sourceStart
      );
      if (i < 0) {
        chipsAfterSource.set(c.sourceId, [...(chipsAfterSource.get(c.sourceId) ?? []), c]);
      } else {
        chipsBefore.set(i, [...(chipsBefore.get(i) ?? []), c]);
      }
    }
    // palavra onde cada motion (não rejeitado) começa: a última que inicia até a âncora
    const motionAt = new Map<number, string>();
    for (const m of recipe.motions) {
      if (m.status === "rejected") continue;
      let idx = -1;
      words.forEach((w, i) => {
        if (w.sourceId === m.sourceId && w.start <= m.sourceTime + 0.01) idx = i;
      });
      if (idx >= 0) motionAt.set(idx, [motionAt.get(idx), MOTION_LABEL[m.kind]].filter(Boolean).join(", "));
    }
    return { words, lists, posInSource, kept, pending, wordSug, chipsBefore, chipsAfterSource, motionAt };
  }, [recipe, segments]);

  const { words, lists, posInSource, kept, pending } = model;

  const activeIndex = useMemo(() => {
    if (!playheadSource) return -1;
    let found = -1;
    words.forEach((w, i) => {
      if (w.sourceId === playheadSource.sourceId && w.start <= playheadSource.seconds) {
        found = i;
      }
    });
    if (found < 0) return -1;
    return playheadSource.seconds - words[found].start < ACTIVE_WORD_HOLD ? found : -1;
  }, [words, playheadSource]);

  // acompanha o playhead sem rolar o resto da coluna de painéis
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || activeIndex < 0 || dragging.current) return;
    const el = box.querySelector<HTMLElement>(`[data-i="${activeIndex}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 24) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [activeIndex]);

  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const range = selection
    ? [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)]
    : null;

  /** Para cada fonte dentro da seleção: faixa [from, to] na lista daquela fonte */
  const selectionRuns = (): { sourceId: string; words: TranscriptWord[]; from: number; to: number }[] => {
    if (!range) return [];
    const runs = new Map<string, { from: number; to: number }>();
    for (let i = range[0]; i <= range[1]; i++) {
      const w = words[i];
      const pos = posInSource[i];
      const r = runs.get(w.sourceId);
      runs.set(w.sourceId, r ? { from: Math.min(r.from, pos), to: Math.max(r.to, pos) } : { from: pos, to: pos });
    }
    return [...runs.entries()].map(([sourceId, r]) => ({
      sourceId,
      words: lists.get(sourceId)!,
      ...r,
    }));
  };

  const setSegments = (next: Segment[]) =>
    onChange({ ...recipe, timeline: { ...recipe.timeline, segments: next } });

  const cutSelection = () => {
    let next = segments;
    for (const run of selectionRuns()) {
      const { start, end } = wordsCutRange(run.words, run.from, run.to);
      next = applyCutToSegments(next, run.sourceId, start, end);
    }
    if (next.length === 0) {
      setNotice("Esse corte removeria o vídeo inteiro.");
      return;
    }
    setSegments(next);
    setSelection(null);
  };

  const restoreSelection = () => {
    let next = segments;
    for (const run of selectionRuns()) {
      const { start, end } = wordsRestoreRange(run.words, run.from, run.to);
      next = restoreSourceRange(next, run.sourceId, start, end);
    }
    setSegments(next);
    setSelection(null);
  };

  const selectionAllCut =
    range !== null && kept.slice(range[0], range[1] + 1).every((k) => !k);

  const toggleSelection = () => {
    if (!range) return;
    if (selectionAllCut) restoreSelection();
    else cutSelection();
  };

  const seekToWord = (i: number) => {
    const w = words[i];
    const out =
      sourceToOutput(segments, w.sourceId, w.start) ??
      sourceToOutput(segments, w.sourceId, wordMid(w));
    if (out !== null) onSeek(out);
  };

  const commitWordText = (i: number, text: string) => {
    setEditing(null);
    const value = text.trim();
    const w = words[i];
    if (!value || value === w.text) return;
    onChange({
      ...recipe,
      captions: {
        ...recipe.captions,
        blocks: recipe.captions.blocks.map((b) =>
          b.id !== w.blockId
            ? b
            : {
                ...b,
                words: b.words.map((bw, wi) => (wi === w.wordIndex ? { ...bw, text: value } : bw)),
              }
        ),
      },
    });
  };

  const review = (ids: string[], accept: boolean) => {
    const next = reviewSuggestions(recipe, ids, accept);
    const skipped = ids.filter(
      (id) => next.timeline.suggestedCuts.find((c) => c.id === id)?.status === "pending"
    );
    if (skipped.length > 0) setNotice("Um corte foi ignorado: removeria o vídeo inteiro.");
    onChange(next);
  };

  const wordIndexFromEvent = (e: React.MouseEvent): number | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    return el ? Number(el.dataset.i) : null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || editing !== null) return;
    const i = wordIndexFromEvent(e);
    if (i === null) return;
    e.preventDefault(); // evita seleção nativa de texto
    scrollRef.current?.focus();
    dragging.current = true;
    if (e.shiftKey && selection) {
      setSelection({ anchor: selection.anchor, focus: i });
    } else {
      setSelection({ anchor: i, focus: i });
      if (kept[i]) seekToWord(i);
    }
  };

  const onMouseOver = (e: React.MouseEvent) => {
    if (!dragging.current || !selection) return;
    const i = wordIndexFromEvent(e);
    if (i !== null && i !== selection.focus) setSelection({ ...selection, focus: i });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing !== null) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      toggleSelection();
    } else if (e.key === "Escape") {
      setSelection(null);
    } else if (e.key === "Enter" && range && range[0] === range[1]) {
      e.preventDefault();
      setEditing(range[0]);
    }
  };

  const byReason = CUT_REASONS.map((reason) => ({
    reason,
    ids: pending.filter((c) => c.reason === reason).map((c) => c.id),
  })).filter((g) => g.ids.length > 0);

  const keptCount = kept.filter(Boolean).length;
  const multiSource = lists.size > 1;

  const chip = (c: SuggestedCut) => (
    <span
      key={c.id}
      className={`sug-chip reason-${c.reason}`}
      title={`${CUT_REASON_LABEL[c.reason]} · confiança ${c.confidence}${c.note ? `\n${c.note}` : ""}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {CUT_REASON_LABEL[c.reason]}
      {c.reason === "pause" || c.reason === "silence"
        ? ` ${(c.sourceEnd - c.sourceStart).toFixed(1)}s`
        : ""}
      <button className="ok" title="Aceitar corte" onClick={() => review([c.id], true)}>
        <Icon name="check" size={11} />
      </button>
      <button className="no" title="Rejeitar" onClick={() => review([c.id], false)}>
        <Icon name="x" size={11} />
      </button>
    </span>
  );

  const content: React.ReactNode[] = [];
  words.forEach((w, i) => {
    if (multiSource && (i === 0 || words[i - 1].sourceId !== w.sourceId)) {
      if (i > 0) {
        for (const c of model.chipsAfterSource.get(words[i - 1].sourceId) ?? []) content.push(chip(c));
      }
      content.push(
        <div key={`src-${w.sourceId}`} className="transcript-source">
          {w.sourceId}
        </div>
      );
    }
    for (const c of model.chipsBefore.get(i) ?? []) content.push(chip(c));
    const sug = model.wordSug[i];
    const cls = [
      "tw",
      kept[i] ? "" : "cut",
      sug ? `in-sug reason-${sug.reason}` : "",
      range && i >= range[0] && i <= range[1] ? "selected" : "",
      i === activeIndex ? "active" : "",
      model.motionAt.has(i) ? "motion-anchor" : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (editing === i) {
      content.push(
        <input
          key={w.key}
          className="tw-edit"
          defaultValue={w.text}
          autoFocus
          size={Math.max(w.text.length + 2, 4)}
          onBlur={(e) => commitWordText(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(null);
            e.stopPropagation();
          }}
        />,
        " "
      );
      return;
    }
    content.push(
      <span
        key={w.key}
        data-i={i}
        className={cls}
        title={model.motionAt.has(i) ? `Motion: ${model.motionAt.get(i)}` : undefined}
        onDoubleClick={() => setEditing(i)}
      >
        {w.text}
      </span>,
      " "
    );
  });
  const lastSource = words[words.length - 1]?.sourceId;
  if (lastSource) {
    for (const c of model.chipsAfterSource.get(lastSource) ?? []) content.push(chip(c));
  }

  return (
    <section className="dock transcript-dock">
      {head ?? (
        <header className="dock-head">
          <span className="dock-title">Transcrição</span>
        </header>
      )}

      <div className="dock-body">
        {byReason.length > 0 && (
          <div className="sug-summary">
            {byReason.map(({ reason, ids }) => (
              <span key={reason} className={`sug-group reason-${reason}`}>
                <span className="sug-dot" />
                {CUT_REASON_LABEL[reason as CutReason]}
                <strong>{ids.length}</strong>
                <button className="accept" title={`Aceitar todas (${ids.length})`} onClick={() => review(ids, true)}>
                  <Icon name="check" size={13} />
                </button>
                <button className="reject" title={`Rejeitar todas (${ids.length})`} onClick={() => review(ids, false)}>
                  <Icon name="x" size={13} />
                </button>
              </span>
            ))}
          </div>
        )}

        {words.length === 0 ? (
          <p className="empty-hint">
            Sem transcrição ainda. Use <strong>Transcrever</strong> na barra de cima: a fala vira
            texto editável, e apagar uma palavra corta o vídeo.
          </p>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="transcript"
              tabIndex={0}
              onMouseDown={onMouseDown}
              onMouseOver={onMouseOver}
              onKeyDown={onKeyDown}
            >
              {content}
            </div>
            <div className="transcript-actions">
              {range ? (
                <>
                  <span className="sel-count">
                    {range[1] - range[0] + 1} {range[1] === range[0] ? "palavra" : "palavras"}
                  </span>
                  <button className="sm ghost" onClick={() => setSelection(null)}>
                    Cancelar
                  </button>
                  {selectionAllCut ? (
                    <button className="sm primary" onClick={restoreSelection}>
                      Restaurar <Kbd>⌫</Kbd>
                    </button>
                  ) : (
                    <button className="sm danger" onClick={cutSelection}>
                      <Icon name="scissors" size={13} /> Cortar <Kbd>⌫</Kbd>
                    </button>
                  )}
                </>
              ) : (
                <>
                <span className="hint">
                  Clique numa palavra para ir até ela · arraste para selecionar · <Kbd>⌫</Kbd> corta ou
                  restaura · duplo clique corrige
                </span>
                <span className="transcript-count">{keptCount}/{words.length} no corte</span>
                </>
              )}
              {notice && <span className="error">{notice}</span>}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

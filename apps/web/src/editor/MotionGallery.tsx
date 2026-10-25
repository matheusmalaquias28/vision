import { Player } from "@remotion/player";
import {
  COMBO_IDS,
  comboPreviewPieces,
  MOTION_CATEGORY_LABEL,
  MOTION_COMBOS,
  MOTION_GALLERY_ORDER,
  MOTION_REGISTRY,
  MotionSchema,
  type CaptionStyle,
  type ComboId,
  type MotionCategory,
  type MotionKind,
} from "@vision/recipe";
import { MotionPreviewComposition, type PreviewPiece } from "@vision/video";
import React, { useMemo, useState } from "react";
import { Icon } from "./Icon";

/**
 * Biblioteca de motions e receitas, lida do Motion Registry: finalidade,
 * quando usar/evitar e variantes em linguagem humana. Só UM Player existe,
 * e só para o item aberto (nada de dezenas de players parados na lista).
 */

type Item = { type: "motion"; kind: MotionKind } | { type: "combo"; id: ComboId };
type Filter = "all" | MotionCategory | "combos";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "combos", label: "Receitas" },
  { id: "typography", label: MOTION_CATEGORY_LABEL.typography },
  { id: "data", label: MOTION_CATEGORY_LABEL.data },
  { id: "overlay", label: MOTION_CATEGORY_LABEL.overlay },
  { id: "camera", label: MOTION_CATEGORY_LABEL.camera },
  { id: "element", label: MOTION_CATEGORY_LABEL.element },
];

const PREVIEW_FPS = 30;

/** Prévia de um tipo: params padrão do registry, duração padrão */
function motionPieces(kind: MotionKind): PreviewPiece[] {
  const man = MOTION_REGISTRY[kind];
  return [
    {
      at: 0,
      motion: MotionSchema.parse({
        id: `preview-${kind}`,
        kind,
        sourceId: "preview",
        sourceTime: 0,
        durationSeconds: man.seconds.default,
        params: man.defaults(),
      }),
    },
  ];
}

const Preview: React.FC<{ pieces: PreviewPiece[]; style: CaptionStyle; file: string | null; accent: string | null }> = ({
  pieces,
  style,
  file,
  accent,
}) => {
  const seconds = Math.max(...pieces.map((p) => p.at + p.motion.durationSeconds)) + 0.6;
  const inputProps = useMemo(() => ({ pieces, style, file, accent }), [pieces, style, file, accent]);
  return (
    <div className="gallery-preview">
      <Player
        component={MotionPreviewComposition}
        inputProps={inputProps}
        durationInFrames={Math.round(seconds * PREVIEW_FPS)}
        fps={PREVIEW_FPS}
        compositionWidth={1080}
        compositionHeight={1920}
        autoPlay
        loop
        clickToPlay={false}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};

interface MotionGalleryProps {
  style: CaptionStyle;
  /** Cor padrão dos motions do vídeo (a prévia já mostra com ela) */
  accent: string | null;
  /** Vídeo do projeto como fundo da prévia */
  previewFile: string | null;
  canInsert: boolean;
  onInsertMotion: (kind: MotionKind) => void;
  onInsertCombo: (id: ComboId) => void;
}

export const MotionGallery: React.FC<MotionGalleryProps> = ({ style, accent, previewFile, canInsert, onInsertMotion, onInsertCombo }) => {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Item | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));

  const items: Item[] = [
    ...(filter === "all" || filter === "combos"
      ? COMBO_IDS.filter((id) => {
          const c = MOTION_COMBOS[id];
          return matches(c.label, c.purpose, ...c.useWhen);
        }).map((id) => ({ type: "combo" as const, id }))
      : []),
    ...(filter === "combos"
      ? []
      : MOTION_GALLERY_ORDER.filter((k) => {
          const m = MOTION_REGISTRY[k];
          return (filter === "all" || m.category === filter) && matches(m.label, m.purpose, ...m.useWhen);
        }).map((kind) => ({ type: "motion" as const, kind }))),
  ];

  const isOpen = (it: Item) =>
    open !== null && open.type === it.type && (it.type === "motion" ? open.type === "motion" && open.kind === it.kind : open.type === "combo" && open.id === it.id);

  const pieces = useMemo(
    () => (open === null ? null : open.type === "motion" ? motionPieces(open.kind) : comboPreviewPieces(open.id)),
    [open]
  );

  return (
    <div className="gallery">
      <div className="gallery-tools">
        <div className="gallery-search">
          <Icon name="search" size={13} />
          <input placeholder="Buscar: número, CTA, lista…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="gallery-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 && <p className="empty-hint">Nada com “{query}”.</p>}

      <div className="gallery-list">
        {items.map((it) => {
          const key = it.type === "motion" ? it.kind : it.id;
          const meta =
            it.type === "motion"
              ? { label: MOTION_REGISTRY[it.kind].label, purpose: MOTION_REGISTRY[it.kind].purpose, cls: `kind-${it.kind}` }
              : { label: MOTION_COMBOS[it.id].label, purpose: MOTION_COMBOS[it.id].purpose, cls: "kind-combo" };
          const expanded = isOpen(it);
          return (
            <div key={key} className={`gallery-item ${meta.cls} ${expanded ? "open" : ""}`}>
              <button className="gallery-row" onClick={() => setOpen(expanded ? null : it)}>
                <span className="kind-dot" />
                <span className="gallery-name">
                  {meta.label}
                  {it.type === "combo" && <span className="pill">receita</span>}
                </span>
                <span className="gallery-purpose">{meta.purpose}</span>
                <Icon name={expanded ? "chevronUp" : "chevronDown"} size={12} />
              </button>
              {expanded && pieces && (
                <div className="gallery-detail">
                  <Preview pieces={pieces} style={style} file={previewFile} accent={accent} />
                  <div className="gallery-info">
                    {it.type === "motion" ? <MotionInfo kind={it.kind} /> : <ComboInfo id={it.id} />}
                    <button
                      className="sm primary"
                      disabled={!canInsert}
                      title={canInsert ? "Insere no playhead (você ajusta depois)" : "Posicione o playhead sobre o vídeo"}
                      onClick={() => (it.type === "motion" ? onInsertMotion(it.kind) : onInsertCombo(it.id))}
                    >
                      <Icon name="plus" size={13} /> Inserir no playhead
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Uses: React.FC<{ use: string[]; avoid: string[] }> = ({ use, avoid }) => (
  <dl className="gallery-uses">
    <dt>Quando usar</dt>
    <dd>{use.join(" · ")}</dd>
    <dt>Evitar</dt>
    <dd>{avoid.join(" · ")}</dd>
  </dl>
);

const MotionInfo: React.FC<{ kind: MotionKind }> = ({ kind }) => {
  const m = MOTION_REGISTRY[kind];
  return (
    <>
      <Uses use={m.useWhen} avoid={m.avoidWhen} />
      {m.variants.length > 0 && (
        <div className="gallery-variants">
          {m.variants.map((v) => (
            <span key={v.value} className="variant-chip" title={v.use}>
              {v.label}
            </span>
          ))}
        </div>
      )}
      <p className="gallery-meta">
        {m.seconds.min}–{m.seconds.max}s · {MOTION_CATEGORY_LABEL[m.category]}
      </p>
    </>
  );
};

const ComboInfo: React.FC<{ id: ComboId }> = ({ id }) => {
  const c = MOTION_COMBOS[id];
  return (
    <>
      <Uses use={c.useWhen} avoid={c.avoidWhen} />
      <p className="gallery-meta">
        {c.uses.map((k) => MOTION_REGISTRY[k].label).join(" + ")} · {c.seconds.min}–{c.seconds.max}s
      </p>
    </>
  );
};

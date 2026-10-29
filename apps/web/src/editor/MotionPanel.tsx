import {
  applyAccentToAll,
  interpretBriefing,
  MAX_ILLUSTRATIONS,
  parseChartItems,
  buildComboMotions,
  motionGroupLabel,
  PUNCH_IN_GROUP,
  CREATIVE_PRESETS,
  MOTION_GALLERY_ORDER,
  MOTION_LABEL,
  MOTION_REGISTRY,
  motionOutputStart,
  motionResizable,
  motionSummary,
  removeMotionGroup,
  reviewMotions,
  SCREEN_LIST_EXAMPLE,
  sourceToOutput,
  type Asset,
  type ComboId,
  type Motion,
  type MotionKind,
  type Recipe,
  type SourceTime,
  videoMotionAccent,
} from "@vision/recipe";
import React, { useState } from "react";
import { mediaUrl, type CreativeReport, type IllustrationJob, type IllustrationReport } from "../api";
import {
  ColorField,
  Prop,
  ScrubNumber,
  Section,
  Segmented,
  Select,
  Slider,
  Toggle,
} from "../ui/controls";
import { Icon } from "./Icon";
import { IllustrationGallery } from "./IllustrationGallery";
import { MotionSoundField, MotionSoundSection } from "./MotionSound";

const QUICK_EMOJIS = ["🔥", "💰", "⚠️", "⏰", "✅", "❌", "📈", "💡", "👀", "🎯", "🤝", "⚖️"];

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** Motion novo com os parâmetros padrão do registry, ancorado no playhead */
function newMotion(kind: MotionKind, at: SourceTime): Motion {
  const man = MOTION_REGISTRY[kind];
  return {
    id: `mo_m${Date.now().toString(36)}`,
    kind,
    sourceId: at.sourceId,
    sourceTime: Math.round(at.seconds * 1000) / 1000,
    durationSeconds: man.seconds.default,
    status: "accepted",
    origin: "manual",
    note: "",
    placement: null,
    group: null,
    accentColor: null,
    size: 1,
    params: man.defaults(),
  } as Motion;
}

/** Motion manual no playhead (Biblioteca e "+ No playhead") */
export function insertMotion(recipe: Recipe, kind: MotionKind, at: SourceTime): { recipe: Recipe; id: string } {
  const m = newMotion(kind, at);
  return { recipe: { ...recipe, motions: [...recipe.motions, m] }, id: m.id };
}

/** Receita (combo) no playhead; seleciona a peça de texto, a que o editor costuma ajustar */
export function insertCombo(recipe: Recipe, id: ComboId, at: SourceTime): { recipe: Recipe; id: string } | null {
  const out = sourceToOutput(recipe.timeline.segments, at.sourceId, at.seconds);
  if (out === null) return null;
  const pieces = buildComboMotions(recipe, id, out, `mo_c${Date.now().toString(36)}`);
  if (!pieces) return null;
  const text = pieces.find((p) => MOTION_REGISTRY[p.kind].layer === "text") ?? pieces[0];
  return { recipe: { ...recipe, motions: [...recipe.motions, ...pieces] }, id: text.id };
}

/** Param que guarda a "variante" de cada tipo (os rótulos vêm do registry) */
const VARIANT_KEY: Partial<Record<MotionKind, string>> = {
  zoom: "style",
  flash: "intensity",
  bubble: "side",
  callout: "pointer",
  speedLines: "intensity",
  transition: "style",
};
const VARIANT_LABEL: Partial<Record<MotionKind, string>> = {
  zoom: "Estilo",
  flash: "Intensidade",
  bubble: "Lado",
  annotation: "Marcação",
  chart: "Tipo",
  callout: "Bico",
  speedLines: "Intensidade",
  screen: "Fundo",
  transition: "Modelo",
};

const STYLE_LABEL = Object.fromEntries(
  Object.entries(CREATIVE_PRESETS).map(([k, v]) => [k, v.label])
) as Record<string, string>;

/** Resumo da última rodada da IA: o que entrou, o que foi recusado e por quê */
const ReportBox: React.FC<{ report: CreativeReport }> = ({ report }) => {
  const [showRejected, setShowRejected] = useState(false);
  const secs = (report.timings.totalMs / 1000).toFixed(1);
  return (
    <div className="creative-report">
      <div className="cr-line">
        <span className="pill">{STYLE_LABEL[report.style] ?? report.style}</span>
        <span className="cr-muted">
          {report.styleSource === "briefing" ? "pelo briefing" : report.styleSource === "ia" ? "escolhido pela IA" : "padrão"}
        </span>
        <span className="spacer" />
        <span className="cr-muted" title={report.tokens ? `${report.tokens.input} tokens de entrada + ${report.tokens.output} de saída · ${report.model}` : undefined}>
          {report.cacheHit ? "do cache · 0 tokens" : `${secs}s${report.tokens ? ` · ${report.tokens.input + report.tokens.output} tokens` : ""}`}
        </span>
      </div>
      <div className="cr-line">
        <strong>{report.applied}</strong>&nbsp;de {report.proposed} sugestões aplicadas
        {report.avoid.length > 0 && <span className="cr-muted">&nbsp;· sem {report.avoid.map((k) => MOTION_LABEL[k as MotionKind] ?? k).join(", ").toLowerCase()}</span>}
      </div>
      {report.music && (
        <div className="cr-line" title={report.music.why}>
          <span className="cr-muted">Música sugerida:</span>&nbsp;<strong>{report.music.name}</strong>
          <span className="cr-muted">&nbsp;· aceite ou troque no painel Áudio</span>
        </div>
      )}
      {report.fallback && (
        <p className="note error">A IA não respondeu ({report.fallback}). Entrou um plano básico; tente de novo.</p>
      )}
      {report.rejected.length > 0 && (
        <>
          <button className="link-btn" onClick={() => setShowRejected(!showRejected)}>
            {showRejected ? "Ocultar" : "Ver"} {report.rejected.length} recusada(s) pelas regras
          </button>
          {showRejected && (
            <ul className="cr-rejected">
              {report.rejected.map((r, i) => (
                <li key={i}>
                  <code>{r.ref}</code> {r.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

interface MotionPanelProps {
  recipe: Recipe;
  selectedId: string | null;
  playheadSource: SourceTime | null;
  suggesting: boolean;
  report: CreativeReport | null;
  onOpenLibrary: () => void;
  /** SFX da biblioteca (som dos motions) */
  sfx: Asset[];
  /** Geração de imagem das ilustrações, por id do motion */
  illustrations: Record<string, IllustrationJob>;
  onGenerateIllustration: (motionId: string, fresh: boolean) => void;
  suggestingImages: boolean;
  /** Alguma etapa da IA rodando (o botão espera) */
  pipelineBusy: boolean;
  imagesReport: IllustrationReport | null;
  /** Muda quando alguma imagem foi gerada (recarrega a galeria) */
  imagesVersion: number;
  onSuggestImages: (instructions: string) => void;
  onSuggest: (instructions: string, force: boolean) => void;
  onChange: (recipe: Recipe) => void;
  onSelect: (id: string | null) => void;
  onSeek: (outputSeconds: number) => void;
}

export const MotionPanel: React.FC<MotionPanelProps> = ({
  recipe,
  selectedId,
  playheadSource,
  suggesting,
  report,
  onOpenLibrary,
  sfx,
  illustrations,
  onGenerateIllustration,
  suggestingImages,
  pipelineBusy,
  imagesReport,
  imagesVersion,
  onSuggestImages,
  onSuggest,
  onChange,
  onSelect,
  onSeek,
}) => {
  const [instructions, setInstructions] = useState("");
  const [showRejected, setShowRejected] = useState(false);
  const segments = recipe.timeline.segments;

  const rows = recipe.motions
    .map((m) => ({ m, start: motionOutputStart(segments, m) }))
    .filter(({ m }) => showRejected || m.status !== "rejected")
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  const pendingIds = recipe.motions.filter((m) => m.status === "pending").map((m) => m.id);
  const rejectedCount = recipe.motions.filter((m) => m.status === "rejected").length;
  const selected = recipe.motions.find((m) => m.id === selectedId);
  const ownColors = recipe.motions.filter((m) => m.accentColor !== null && MOTION_REGISTRY[m.kind].usesAccent).length;

  const setMotions = (motions: Motion[]) => onChange({ ...recipe, motions });

  /** Editar uma sugestão = endossar: vira aceita (e não some ao re-sugerir) */
  const replace = (next: Motion) =>
    setMotions(
      recipe.motions.map((m) =>
        m.id === next.id
          ? ({ ...next, status: next.status === "pending" ? "accepted" : next.status } as Motion)
          : m
      )
    );

  const patchParams = (m: Motion, p: Record<string, unknown>) =>
    replace({ ...m, params: { ...m.params, ...p } } as Motion);

  const add = (kind: MotionKind) => {
    if (!playheadSource) return;
    const out = insertMotion(recipe, kind, playheadSource);
    onChange(out.recipe);
    onSelect(out.id);
  };

  const review = (ids: string[], accept: boolean) => onChange(reviewMotions(recipe, ids, accept));

  return (
    <>
      <Section title="Sugerir com IA">
        <div className="ask-ai">
          <input
            placeholder="Pedido opcional: mais premium, sem emoji…"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !suggesting) onSuggest(instructions, false);
            }}
          />
          <button
            className="primary"
            disabled={suggesting}
            title="Uma chamada de IA: lê o briefing do War e a fala, escolhe motions e receitas. Tudo entra como sugestão."
            onClick={() => onSuggest(instructions, false)}
          >
            <Icon name="sparkles" size={14} />
            {suggesting ? "Pensando…" : "Sugerir"}
          </button>
        </div>
        {report && (
          <>
            <ReportBox report={report} />
            {report.cacheHit && (
              <button className="link-btn" disabled={suggesting} onClick={() => onSuggest(instructions, true)}>
                Pedir um plano novo à IA (gasta tokens)
              </button>
            )}
          </>
        )}
        {pendingIds.length > 0 && (
          <div className="review-bar">
            <strong>{pendingIds.length}</strong> para revisar
            <span className="spacer" />
            <button className="sm reject" onClick={() => review(pendingIds, false)}>
              Rejeitar todas
            </button>
            <button className="sm accept" onClick={() => review(pendingIds, true)}>
              <Icon name="check" size={13} /> Aceitar todas
            </button>
          </div>
        )}
      </Section>

      <ImagesSection
        recipe={recipe}
        instructions={instructions}
        busy={suggestingImages}
        disabled={pipelineBusy}
        report={imagesReport}
        onSuggest={onSuggestImages}
      >
        <IllustrationGallery
          recipe={recipe}
          selected={selected}
          playheadSource={playheadSource}
          version={imagesVersion}
          onChange={onChange}
          onSelect={onSelect}
        />
      </ImagesSection>

      <MotionSoundSection recipe={recipe} sfx={sfx} onChange={onChange} />

      <Section title="Cor dos motions">
        <Prop label="Destaque do vídeo">
          <ColorField
            value={videoMotionAccent(recipe)}
            onChange={(v) => onChange({ ...recipe, motionStyle: { ...recipe.motionStyle, accentColor: v } })}
          />
          {recipe.motionStyle.accentColor !== null ? (
            <button
              className="sm ghost"
              title="Volta a usar a cor de destaque da legenda"
              onClick={() => onChange({ ...recipe, motionStyle: { ...recipe.motionStyle, accentColor: null } })}
            >
              Igual à legenda
            </button>
          ) : (
            <span className="prop-hint inline">= cor da legenda</span>
          )}
        </Prop>
        {ownColors > 0 && (
          <div className="row">
            <span className="prop-hint inline">
              {ownColors} motion(s) com cor própria
            </span>
            <span className="spacer" />
            <button
              className="sm"
              title="Todos os motions passam a usar a cor de destaque do vídeo"
              onClick={() => onChange(applyAccentToAll(recipe, recipe.motionStyle.accentColor))}
            >
              Usar a do vídeo em todos
            </button>
          </div>
        )}
      </Section>

      <Section
        title={`Na timeline (${rows.length})`}
        actions={
          <>
          <button className="sm ghost" title="Galeria com prévia de todos os motions e receitas (coluna da esquerda)" onClick={onOpenLibrary}>
            <Icon name="layers" size={13} /> Biblioteca
          </button>
          <Select
            className="add-select"
            value=""
            disabled={!playheadSource}
            title={playheadSource ? "Adicionar no playhead" : "Posicione o playhead sobre o vídeo"}
            onChange={(e) => e.target.value && add(e.target.value as MotionKind)}
          >
            <option value="">+ No playhead</option>
            {MOTION_GALLERY_ORDER.map((k) => (
              <option key={k} value={k}>
                {MOTION_LABEL[k]}
              </option>
            ))}
          </Select>
          </>
        }
      >
        {rows.length === 0 ? (
          <p className="empty-hint">
            Sem motions. <strong>Sugerir</strong> pede à IA um plano preso à fala, ou insira um da{" "}
            <button className="link-btn" onClick={onOpenLibrary}>
              Biblioteca
            </button>{" "}
            no playhead.
          </p>
        ) : (
          <div className="list">
            {rows.map(({ m, start }) => (
              <div
                key={m.id}
                className={`list-row kind-${m.kind} status-${m.status} ${m.id === selectedId ? "selected" : ""}`}
                title={m.note || undefined}
                onClick={() => {
                  onSelect(m.id === selectedId ? null : m.id);
                  if (start !== null) onSeek(start);
                }}
              >
                <span className="lr-time">{start === null ? "cortado" : fmtTime(start)}</span>
                <span className="kind-dot" />
                <span className="lr-kind">{MOTION_LABEL[m.kind]}</span>
                <span className="lr-main">
                  {motionSummary(m)}
                  {m.group && <span className="lr-group"> · {motionGroupLabel(m.group)}</span>}
                </span>
                {m.status === "pending" ? (
                  <span className="lr-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="sm icon reject" title="Rejeitar" onClick={() => review([m.id], false)}>
                      <Icon name="x" size={13} />
                    </button>
                    <button className="sm icon accept" title="Aceitar" onClick={() => review([m.id], true)}>
                      <Icon name="check" size={13} />
                    </button>
                  </span>
                ) : m.status === "rejected" ? (
                  <span className="pill">rejeitado</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {rejectedCount > 0 && (
          <button className="link-btn" onClick={() => setShowRejected(!showRejected)}>
            {showRejected ? "Ocultar" : "Mostrar"} rejeitados ({rejectedCount})
          </button>
        )}
      </Section>

      {selected && (
        <Section
          key={selected.id}
          title={`${MOTION_LABEL[selected.kind]} · propriedades`}
          actions={
            selected.status === "pending" ? <span className="pill pending">sugestão</span> : null
          }
        >
          {selected.note && <p className="note">{selected.note}</p>}
          <p className="prop-hint">{MOTION_REGISTRY[selected.kind].purpose}</p>

          {MOTION_REGISTRY[selected.kind].variants.length > 0 && (
            <Prop label={VARIANT_LABEL[selected.kind] ?? "Variante"}>
              <Segmented
                value={(selected.params as Record<string, string>)[VARIANT_KEY[selected.kind] ?? "variant"]}
                options={MOTION_REGISTRY[selected.kind].variants.map((v) => ({ value: v.value, label: v.label, title: v.use }))}
                onChange={(v) => patchParams(selected, { [VARIANT_KEY[selected.kind] ?? "variant"]: v })}
              />
            </Prop>
          )}

          <MotionFields m={selected} patch={(p) => patchParams(selected, p)} />
          {selected.kind === "illustration" && (
            <IllustrationImage
              m={selected}
              job={illustrations[selected.id]}
              onGenerate={(fresh) => {
                // gerar à mão também endossa a sugestão
                if (selected.status === "pending") replace(selected);
                onGenerateIllustration(selected.id, fresh);
              }}
            />
          )}
          <MotionSoundField recipe={recipe} motion={selected} sfx={sfx} onChange={onChange} />

          {MOTION_REGISTRY[selected.kind].usesAccent && (
            <Prop label="Cor de destaque">
              <ColorField
                value={selected.accentColor ?? videoMotionAccent(recipe)}
                onChange={(v) => replace({ ...selected, accentColor: v })}
              />
              {selected.accentColor !== null && (
                <button className="sm ghost" title="Volta para a cor padrão do vídeo" onClick={() => replace({ ...selected, accentColor: null })}>
                  Padrão
                </button>
              )}
              <button
                className="sm ghost"
                title="Esta cor vira a padrão do vídeo e vale para todos os motions"
                onClick={() => onChange(applyAccentToAll(recipe, selected.accentColor ?? videoMotionAccent(recipe)))}
              >
                Aplicar a todos
              </button>
            </Prop>
          )}

          {motionResizable(selected) && (
            <Prop label="Escala" hint="Tamanho na tela; também pela alça no canto do elemento, no preview">
              <Slider
                value={selected.size}
                min={0.3}
                max={3}
                step={0.05}
                unit="%"
                format={(v) => String(Math.round(v * 100))}
                parse={(s) => Number(s) / 100}
                onChange={(v) => replace({ ...selected, size: v })}
              />
              {selected.size !== 1 && (
                <button className="sm ghost" title="Volta ao tamanho padrão do tipo" onClick={() => replace({ ...selected, size: 1 })}>
                  Padrão
                </button>
              )}
            </Prop>
          )}

          <Prop label="Duração">
            <ScrubNumber
              value={selected.durationSeconds}
              min={0.1}
              max={15}
              step={0.1}
              unit="s"
              pxPerStep={6}
              onChange={(v) => replace({ ...selected, durationSeconds: v })}
            />
          </Prop>

          {selected.group && (
            <div className="group-box">
              <span>
                Parte de <strong>{motionGroupLabel(selected.group)}</strong>
              </span>
              <button
                className="sm danger"
                onClick={() => {
                  onChange(removeMotionGroup(recipe, selected.group!));
                  onSelect(null);
                }}
              >
                <Icon name="trash" size={13} />{" "}
                {selected.group === PUNCH_IN_GROUP
                  ? `Remover todos (${recipe.motions.filter((m) => m.group === PUNCH_IN_GROUP).length})`
                  : "Remover receita inteira"}
              </button>
            </div>
          )}

          <div className="row">
            <button
              className="sm"
              disabled={!playheadSource}
              title="Ancora o início deste motion onde o playhead está"
              onClick={() =>
                playheadSource &&
                replace({
                  ...selected,
                  sourceId: playheadSource.sourceId,
                  sourceTime: Math.round(playheadSource.seconds * 1000) / 1000,
                })
              }
            >
              <Icon name="anchor" size={13} /> Mover p/ playhead
            </button>
            <button
              className="sm danger"
              onClick={() => {
                setMotions(recipe.motions.filter((m) => m.id !== selected.id));
                onSelect(null);
              }}
            >
              <Icon name="trash" size={13} /> Remover
            </button>
            <span className="spacer" />
            {selected.status === "pending" && (
              <>
                <button className="sm reject" onClick={() => review([selected.id], false)}>
                  Rejeitar
                </button>
                <button className="sm primary" onClick={() => review([selected.id], true)}>
                  Aceitar
                </button>
              </>
            )}
            {selected.status === "rejected" && (
              <button className="sm" onClick={() => replace({ ...selected, status: "accepted" })}>
                Reativar
              </button>
            )}
          </div>
        </Section>
      )}
    </>
  );
};

/**
 * Imagens ilustrativas: botão próprio, fora do Analisar e do Sugerir motions
 * (cada imagem gasta crédito na Magnific). Usa o mesmo pedido do campo acima.
 */
const ImagesSection: React.FC<{
  recipe: Recipe;
  instructions: string;
  busy: boolean;
  disabled: boolean;
  report: IllustrationReport | null;
  onSuggest: (instructions: string) => void;
  /** Galeria das imagens já geradas */
  children?: React.ReactNode;
}> = ({ recipe, instructions, busy, disabled, report, onSuggest, children }) => {
  const hasTranscript = recipe.captions.blocks.some((b) => b.sourceId !== null);
  const askedInBriefing = interpretBriefing(recipe.briefing).wants.includes("illustration");
  const live = recipe.motions.filter((m) => m.kind === "illustration" && m.status !== "rejected").length;
  return (
    <Section
      title="Imagens ilustrativas"
      actions={askedInBriefing ? <span className="pill">o briefing pede</span> : null}
    >
      <p className="prop-hint">
        A IA escolhe até {MAX_ILLUSTRATIONS} pontos-chave da fala e gera as imagens (colagem de papel, 1:1). Entram como
        sugestão, já com a imagem. Não roda no Analisar nem no Sugerir motions: cada imagem gasta crédito.
      </p>
      <button
        className={askedInBriefing ? "primary" : ""}
        disabled={busy || disabled || !hasTranscript}
        title={hasTranscript ? "Uma chamada de IA + até 3 imagens na Magnific (~20 s)" : "Transcreva o vídeo antes"}
        onClick={() => onSuggest(instructions)}
      >
        <Icon name="sparkles" size={14} />
        {busy ? "Gerando imagens…" : live > 0 ? "Sugerir imagens de novo" : "Sugerir imagens"}
      </button>
      {report && !busy && (
        <div className="images-report">
          {report.added === 0 ? (
            <span>Nenhum momento livre para imagem{report.rejected[0] ? ` (${report.rejected[0].reason})` : ""}.</span>
          ) : (
            <span>
              {report.added} {report.added === 1 ? "imagem sugerida" : "imagens sugeridas"} em {report.seconds}s
              {report.images < report.added ? ` · ${report.added - report.images} sem imagem` : ""}
            </span>
          )}
          {report.errors.map((e) => (
            <span key={e} className="illus-error">
              {e}
            </span>
          ))}
        </div>
      )}
      {children}
    </Section>
  );
};

/** Imagem da ilustração: miniatura + gerar (sem imagem, o motion não entra no MP4) */
const IllustrationImage: React.FC<{
  m: Extract<Motion, { kind: "illustration" }>;
  job: IllustrationJob | undefined;
  onGenerate: (fresh: boolean) => void;
}> = ({ m, job, onGenerate }) => {
  const busy = job?.busy ?? false;
  return (
    <Prop label="Imagem">
      <div className="illus-field">
        <div className={`illus-thumb ${busy ? "busy" : ""}`}>
          {m.params.image ? <img src={mediaUrl(m.params.image)} alt="" /> : <span>{busy ? "Gerando…" : "Sem imagem"}</span>}
        </div>
        <div className="illus-actions">
          <button
            className={m.params.image ? "" : "primary"}
            disabled={busy || m.params.subject.trim().length < 2}
            title="Magnific · Nano Banana Pro Flash, 1:1 em 1K, estilo colagem de papel. Gasta crédito a cada imagem nova."
            onClick={() => onGenerate(Boolean(m.params.image))}
          >
            <Icon name="sparkles" size={13} />
            {busy ? "Gerando…" : m.params.image ? "Gerar outra" : "Gerar imagem"}
          </button>
          {job?.error ? (
            <span className="illus-error">{job.error}</span>
          ) : (
            <span className="prop-hint inline">
              {m.params.image ? "Mudou a descrição? Gere outra." : "Sem imagem, não aparece no vídeo final."}
            </span>
          )}
        </div>
      </div>
    </Prop>
  );
};

/** Texto que só aceita valor válido (o schema recusa vazio onde é obrigatório) */
const TextInput: React.FC<{
  value: string;
  max: number;
  required?: boolean;
  placeholder?: string;
  onChange: (v: string) => void;
}> = ({ value, max, required, placeholder, onChange }) => (
  <input
    value={value}
    maxLength={max}
    placeholder={placeholder}
    onChange={(e) => (required && !e.target.value.trim() ? undefined : onChange(e.target.value))}
  />
);

const POSITION_OPTIONS = [
  { value: "top", label: "Topo" },
  { value: "center", label: "Centro", title: "Abaixo do rosto, acima da legenda" },
];

/** Campos de cada tipo (a variante e a duração ficam no painel) */
const MotionFields: React.FC<{ m: Motion; patch: (p: Record<string, unknown>) => void }> = ({ m, patch }) => {
  switch (m.kind) {
    case "zoom":
      return (
        <>
          <Prop label="Intensidade">
            <Slider
              value={m.params.scale}
              min={1.02}
              max={1.6}
              step={0.01}
              unit="%"
              format={(v) => String(Math.round((v - 1) * 100))}
              parse={(s) => 1 + Number(s) / 100}
              onChange={(v) => patch({ scale: v })}
            />
          </Prop>
          <Prop label="Foco horizontal">
            <Slider value={m.params.focusX} min={0} max={100} step={1} unit="%" onChange={(v) => patch({ focusX: v })} />
          </Prop>
          <Prop label="Foco vertical">
            <Slider value={m.params.focusY} min={0} max={100} step={1} unit="%" onChange={(v) => patch({ focusY: v })} />
          </Prop>
        </>
      );
    case "keyword":
      return (
        <>
          <Prop label="Texto">
            <TextInput value={m.params.text} max={40} required onChange={(v) => patch({ text: v })} />
          </Prop>
          <Prop label="Posição">
            <Segmented value={m.params.position} options={POSITION_OPTIONS} onChange={(v) => patch({ position: v })} />
          </Prop>
          <Prop label="Tamanho">
            <Segmented
              value={m.params.intensity}
              options={[
                { value: "subtle", label: "Sutil" },
                { value: "normal", label: "Normal" },
                { value: "strong", label: "Forte" },
              ]}
              onChange={(v) => patch({ intensity: v })}
            />
          </Prop>
        </>
      );
    case "kinetic":
      return (
        <>
          <Prop label="Frase">
            <TextInput value={m.params.text} max={60} required onChange={(v) => patch({ text: v })} />
          </Prop>
          <Prop label="Destaque">
            <TextInput value={m.params.emphasis} max={30} placeholder="palavra em cor" onChange={(v) => patch({ emphasis: v })} />
          </Prop>
          <Prop label="Posição">
            <Segmented value={m.params.position} options={POSITION_OPTIONS} onChange={(v) => patch({ position: v })} />
          </Prop>
        </>
      );
    case "statement":
      return (
        <>
          <Prop label="Texto">
            <TextInput value={m.params.text} max={70} required onChange={(v) => patch({ text: v })} />
          </Prop>
          <Prop label="Linha de cima">
            <TextInput value={m.params.eyebrow} max={30} placeholder="opcional" onChange={(v) => patch({ eyebrow: v })} />
          </Prop>
          {m.params.variant === "cta" && (
            <Prop label="Brilho">
              <Segmented
                value={m.params.shine ? "on" : "off"}
                options={[
                  { value: "off", label: "Sem" },
                  { value: "on", label: "Com", title: "Faixa de luz atravessando o botão" },
                ]}
                onChange={(v) => patch({ shine: v === "on" })}
              />
            </Prop>
          )}
        </>
      );
    case "list":
      return (
        <>
          <Prop label="Título">
            <TextInput value={m.params.title} max={40} placeholder="opcional" onChange={(v) => patch({ title: v })} />
          </Prop>
          <Prop label="Itens (1 por linha)">
            <textarea
              rows={Math.max(3, m.params.items.length)}
              defaultValue={m.params.items.join("\n")}
              onChange={(e) => {
                const items = e.target.value
                  .split("\n")
                  .map((i) => i.trim().slice(0, 40))
                  .filter(Boolean);
                if (items.length >= 2 && items.length <= 5) patch({ items });
              }}
            />
          </Prop>
          <Prop label="Posição">
            <Segmented value={m.params.position} options={POSITION_OPTIONS} onChange={(v) => patch({ position: v })} />
          </Prop>
        </>
      );
    case "bubble":
      return (
        <>
          <Prop label="Mensagem">
            <textarea
              rows={3}
              maxLength={120}
              defaultValue={m.params.text}
              onChange={(e) => e.target.value.trim() && patch({ text: e.target.value })}
            />
          </Prop>
          <Prop label="Quem disse">
            <TextInput value={m.params.sender} max={30} placeholder="opcional" onChange={(v) => patch({ sender: v })} />
          </Prop>
        </>
      );
    case "arrow":
      return (
        <>
          <Prop label="Direção">
            <Segmented
              value={m.params.direction}
              options={[
                { value: "down", label: "↓" },
                { value: "up", label: "↑" },
                { value: "left", label: "←" },
                { value: "right", label: "→" },
              ]}
              onChange={(v) => patch({ direction: v })}
            />
          </Prop>
          <Prop label="Rótulo">
            <TextInput value={m.params.label} max={30} placeholder="opcional" onChange={(v) => patch({ label: v })} />
          </Prop>
        </>
      );
    case "emoji":
      return (
        <>
          <div className="emoji-picks">
            {QUICK_EMOJIS.map((e) => (
              <button key={e} className={e === m.params.emoji ? "on" : ""} onClick={() => patch({ emoji: e })}>
                {e}
              </button>
            ))}
          </div>
          <Prop label="Outro emoji">
            <TextInput value={m.params.emoji} max={16} required onChange={(v) => patch({ emoji: v })} />
          </Prop>
          <Prop label="Posição">
            <Segmented
              value={m.params.position}
              options={[
                { value: "side", label: "Lateral" },
                { value: "top", label: "Topo" },
                { value: "center", label: "Peito" },
              ]}
              onChange={(v) => patch({ position: v })}
            />
          </Prop>
        </>
      );
    case "lowerThird":
      return (
        <>
          <Prop label="Nome">
            <TextInput value={m.params.title} max={40} required onChange={(v) => patch({ title: v })} />
          </Prop>
          <Prop label="Cargo">
            <TextInput value={m.params.subtitle} max={60} onChange={(v) => patch({ subtitle: v })} />
          </Prop>
        </>
      );
    case "counter":
      return (
        <>
          <Prop label="De → até">
            <ScrubNumber
              value={m.params.from}
              step={m.params.decimals > 0 ? 0.1 : 1}
              onChange={(v) => patch({ from: v })}
            />
            <Icon name="chevronRight" size={12} className="muted" />
            <ScrubNumber
              value={m.params.to}
              step={m.params.decimals > 0 ? 0.1 : 1}
              onChange={(v) => patch({ to: v })}
            />
          </Prop>
          <Prop label="Casas decimais">
            <Segmented
              value={m.params.decimals}
              options={[
                { value: 0, label: "0" },
                { value: 1, label: "1" },
                { value: 2, label: "2" },
              ]}
              onChange={(v) => patch({ decimals: v })}
            />
          </Prop>
          <Prop label="Prefixo / sufixo">
            <TextInput value={m.params.prefix} max={8} placeholder="R$ " onChange={(v) => patch({ prefix: v })} />
            <TextInput value={m.params.suffix} max={12} placeholder=" meses" onChange={(v) => patch({ suffix: v })} />
          </Prop>
          <Prop label="Legenda">
            <TextInput value={m.params.label} max={40} placeholder="opcional" onChange={(v) => patch({ label: v })} />
          </Prop>
        </>
      );
    case "flash":
      return (
        <Prop label="Cor">
          <ColorField value={m.params.color} onChange={(v) => patch({ color: v })} />
        </Prop>
      );
    case "annotation":
      return (
        <>
          <Prop label="Frase">
            <TextInput value={m.params.text} max={70} required onChange={(v) => patch({ text: v })} />
          </Prop>
          <Prop label="Palavra marcada">
            <TextInput value={m.params.target} max={40} placeholder="vazio = a mais longa" onChange={(v) => patch({ target: v })} />
          </Prop>
          <Prop label="Posição">
            <Segmented value={m.params.position} options={POSITION_OPTIONS} onChange={(v) => patch({ position: v })} />
          </Prop>
        </>
      );
    case "chart":
      return (
        <>
          <Prop label="Título">
            <TextInput value={m.params.title} max={40} placeholder="opcional" onChange={(v) => patch({ title: v })} />
          </Prop>
          <Prop label="Dados (rótulo: valor)">
            <textarea
              rows={Math.max(3, m.params.items.length)}
              defaultValue={m.params.items.map((i) => `${i.label}: ${i.value}`).join("\n")}
              onChange={(e) => {
                const items = parseChartItems(e.target.value.split("\n").join("|"));
                if (items.length > 0) patch({ items });
              }}
            />
          </Prop>
          <Prop label="Prefixo / sufixo">
            <TextInput value={m.params.prefix} max={6} placeholder="R$ " onChange={(v) => patch({ prefix: v })} />
            <TextInput value={m.params.suffix} max={8} placeholder="%" onChange={(v) => patch({ suffix: v })} />
          </Prop>
          <Prop label="Posição">
            <Segmented value={m.params.position} options={POSITION_OPTIONS} onChange={(v) => patch({ position: v })} />
          </Prop>
        </>
      );
    case "callout":
      return (
        <>
          <Prop label="Texto">
            <TextInput value={m.params.text} max={14} required onChange={(v) => patch({ text: v })} />
          </Prop>
          <Prop label="Posição">
            <Segmented value={m.params.position} options={POSITION_OPTIONS} onChange={(v) => patch({ position: v })} />
          </Prop>
        </>
      );
    case "screen": {
      const isList = m.params.layout === "list";
      return (
        <>
          <Prop label="Modelo" hint={isList ? "Os itens entram um a um; dê 3–4 s ao motion para dar tempo de ler" : undefined}>
            <Segmented
              value={m.params.layout}
              options={[
                { value: "phrase", label: "Frase", title: "Uma frase grande entrando palavra a palavra" },
                { value: "list", label: "Lista", title: "Título + 2 a 5 itens entrando um a um" },
              ]}
              onChange={(v) =>
                patch(
                  v === "list"
                    ? { layout: "list", items: m.params.items.length >= 2 ? m.params.items : SCREEN_LIST_EXAMPLE, align: "left" }
                    : { layout: "phrase" }
                )
              }
            />
          </Prop>
          <Prop label={isList ? "Título" : "Frase"}>
            <TextInput value={m.params.text} max={90} required onChange={(v) => patch({ text: v })} />
          </Prop>
          {isList && (
            <>
              <Prop label="Itens (1 por linha)" hint="2 a 5 itens curtos">
                <textarea
                  key={`${m.id}-items`}
                  rows={Math.max(3, m.params.items.length)}
                  defaultValue={m.params.items.join("\n")}
                  onChange={(e) => {
                    const items = e.target.value
                      .split("\n")
                      .map((i) => i.trim().slice(0, 40))
                      .filter(Boolean);
                    if (items.length >= 2 && items.length <= 5) patch({ items });
                  }}
                />
              </Prop>
              <Prop label="Marcador">
                <Segmented
                  value={m.params.marker}
                  options={[
                    { value: "number", label: "1 2 3", title: "Passos em ordem" },
                    { value: "check", label: "✓", title: "Benefícios, inclusos, documentos" },
                  ]}
                  onChange={(v) => patch({ marker: v })}
                />
              </Prop>
            </>
          )}
          <Prop label="Destaque">
            <TextInput value={m.params.emphasis} max={40} placeholder={isList ? "palavra(s) do título" : "palavra(s) da frase"} onChange={(v) => patch({ emphasis: v })} />
          </Prop>
          <Prop label="Linha de cima">
            <TextInput value={m.params.eyebrow} max={30} placeholder="opcional: PASSO 1" onChange={(v) => patch({ eyebrow: v })} />
          </Prop>
          <Prop label="Tom">
            <Segmented
              value={m.params.tone}
              options={[
                { value: "light", label: "Claro" },
                { value: "dark", label: "Escuro" },
              ]}
              onChange={(v) => patch({ tone: v })}
            />
          </Prop>
          <Prop label="Entrada">
            <Segmented
              value={m.params.transition}
              options={[
                { value: "slide", label: "Sobe", title: "A tela sobe por cima do vídeo e sai subindo" },
                { value: "fade", label: "Suave", title: "Aparece e some em fade" },
              ]}
              onChange={(v) => patch({ transition: v })}
            />
          </Prop>
          <Prop label="Alinhamento">
            <Segmented
              value={m.params.align}
              options={[
                { value: "center", label: "Centro" },
                { value: "left", label: "Esquerda" },
              ]}
              onChange={(v) => patch({ align: v })}
            />
          </Prop>
          <Prop label="Legenda" hint="Enquanto a tela cheia está no ar, a legenda pode sumir (o texto já está na tela)">
            <Toggle
              checked={m.params.hideCaptions}
              onChange={(v) => patch({ hideCaptions: v })}
              label={m.params.hideCaptions ? "Some durante a tela" : "Continua aparecendo"}
            />
          </Prop>
        </>
      );
    }
    case "illustration":
      return (
        <>
          <Prop label="O que desenhar" hint="Objeto ou cena simbólica do ponto-chave. O estilo (colagem de papel) é fixo; sem pessoas reconhecíveis e sem texto.">
            <textarea
              rows={3}
              maxLength={300}
              defaultValue={m.params.subject}
              onChange={(e) => (e.target.value.trim().length >= 2 ? patch({ subject: e.target.value }) : undefined)}
            />
          </Prop>
          <Prop label="Legenda do cartão">
            <TextInput value={m.params.label} max={40} placeholder="opcional, até 4 palavras" onChange={(v) => patch({ label: v })} />
          </Prop>
          <Prop label="Posição">
            <Segmented value={m.params.position} options={POSITION_OPTIONS} onChange={(v) => patch({ position: v })} />
          </Prop>
          <Prop label="Tamanho">
            <Slider
              value={m.params.size}
              min={0.4}
              max={1.25}
              step={0.01}
              unit="%"
              format={(v) => String(Math.round(v * 100))}
              parse={(s) => Number(s) / 100}
              onChange={(v) => patch({ size: v })}
            />
          </Prop>
        </>
      );
    case "transition":
      return (
        <p className="prop-hint">
          Vídeo da biblioteca com som, centralizado no corte. A duração é a do modelo (até 1,3 s).
        </p>
      );
    case "speedLines":
      return (
        <Prop label="Tom">
          <Segmented
            value={m.params.tone}
            options={[
              { value: "light", label: "Claro", title: "Linhas brancas (vídeo escuro)" },
              { value: "dark", label: "Escuro", title: "Linhas pretas (vídeo claro)" },
            ]}
            onChange={(v) => patch({ tone: v })}
          />
        </Prop>
      );
  }
};

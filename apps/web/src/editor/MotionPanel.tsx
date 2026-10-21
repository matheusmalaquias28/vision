import {
  MOTION_KINDS,
  MOTION_LABEL,
  motionOutputStart,
  motionSummary,
  reviewMotions,
  type Motion,
  type MotionKind,
  type Recipe,
  type SourceTime,
} from "@vision/recipe";
import React, { useState } from "react";
import {
  ColorField,
  Prop,
  ScrubNumber,
  Section,
  Segmented,
  Select,
  Slider,
} from "../ui/controls";
import { Icon } from "./Icon";

const QUICK_EMOJIS = ["🔥", "💰", "⚠️", "⏰", "✅", "❌", "📈", "💡", "👀", "🎯", "🤝", "⚖️"];

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** Motion novo com parâmetros padrão, ancorado no playhead */
function newMotion(kind: MotionKind, at: SourceTime): Motion {
  const base = {
    id: `mo_m${Date.now().toString(36)}`,
    sourceId: at.sourceId,
    sourceTime: Math.round(at.seconds * 1000) / 1000,
    status: "accepted" as const,
    origin: "manual" as const,
    note: "",
  };
  switch (kind) {
    case "zoom":
      return { ...base, kind, durationSeconds: 1.2, params: { scale: 1.15, style: "punch" } };
    case "keyword":
      return { ...base, kind, durationSeconds: 1.6, params: { text: "TEXTO", position: "top" } };
    case "emoji":
      return { ...base, kind, durationSeconds: 1.4, params: { emoji: "🔥", position: "side" } };
    case "lowerThird":
      return { ...base, kind, durationSeconds: 3.5, params: { title: "Nome", subtitle: "Cargo" } };
    case "counter":
      return {
        ...base,
        kind,
        durationSeconds: 2.2,
        params: { from: 0, to: 100, decimals: 0, prefix: "", suffix: "", label: "" },
      };
    case "flash":
      return { ...base, kind, durationSeconds: 0.3, params: { color: "#FFFFFF" } };
  }
}

interface MotionPanelProps {
  recipe: Recipe;
  selectedId: string | null;
  playheadSource: SourceTime | null;
  suggesting: boolean;
  onSuggest: (instructions: string) => void;
  onChange: (recipe: Recipe) => void;
  onSelect: (id: string | null) => void;
  onSeek: (outputSeconds: number) => void;
}

export const MotionPanel: React.FC<MotionPanelProps> = ({
  recipe,
  selectedId,
  playheadSource,
  suggesting,
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
    const m = newMotion(kind, playheadSource);
    setMotions([...recipe.motions, m]);
    onSelect(m.id);
  };

  const review = (ids: string[], accept: boolean) => onChange(reviewMotions(recipe, ids, accept));

  return (
    <>
      <Section title="Sugerir com IA">
        <div className="ask-ai">
          <input
            placeholder="Pedido opcional: mais zooms, sem emoji…"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !suggesting) onSuggest(instructions);
            }}
          />
          <button className="primary" disabled={suggesting} onClick={() => onSuggest(instructions)}>
            <Icon name="sparkles" size={14} />
            {suggesting ? "Pensando…" : "Sugerir"}
          </button>
        </div>
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

      <Section
        title={`Na timeline (${rows.length})`}
        actions={
          <Select
            className="add-select"
            value=""
            disabled={!playheadSource}
            title={playheadSource ? "Adicionar no playhead" : "Posicione o playhead sobre o vídeo"}
            onChange={(e) => e.target.value && add(e.target.value as MotionKind)}
          >
            <option value="">+ No playhead</option>
            {MOTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {MOTION_LABEL[k]}
              </option>
            ))}
          </Select>
        }
      >
        {rows.length === 0 ? (
          <p className="empty-hint">
            Sem motions. <strong>Sugerir</strong> pede à IA um plano preso à fala, ou adicione
            um no playhead.
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
                <span className="lr-main">{motionSummary(m)}</span>
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

          {selected.kind === "zoom" && (
            <>
              <Prop label="Intensidade">
                <Slider
                  value={selected.params.scale}
                  min={1.02}
                  max={1.6}
                  step={0.01}
                  unit="%"
                  format={(v) => String(Math.round((v - 1) * 100))}
                  parse={(s) => 1 + Number(s) / 100}
                  onChange={(v) => patchParams(selected, { scale: v })}
                />
              </Prop>
              <Prop label="Estilo">
                <Segmented
                  value={selected.params.style}
                  options={[
                    { value: "punch", label: "Punch", title: "Entra seco: ênfase" },
                    { value: "smooth", label: "Suave", title: "Aproxima devagar: explicação" },
                  ]}
                  onChange={(v) => patchParams(selected, { style: v })}
                />
              </Prop>
            </>
          )}

          {selected.kind === "keyword" && (
            <>
              <Prop label="Texto">
                <input
                  value={selected.params.text}
                  maxLength={40}
                  onChange={(e) => e.target.value && patchParams(selected, { text: e.target.value })}
                />
              </Prop>
              <Prop label="Posição">
                <Segmented
                  value={selected.params.position}
                  options={[
                    { value: "top", label: "Topo" },
                    { value: "center", label: "Peito", title: "Abaixo do rosto, acima da legenda" },
                  ]}
                  onChange={(v) => patchParams(selected, { position: v })}
                />
              </Prop>
            </>
          )}

          {selected.kind === "emoji" && (
            <>
              <div className="emoji-picks">
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    className={e === selected.params.emoji ? "on" : ""}
                    onClick={() => patchParams(selected, { emoji: e })}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <Prop label="Outro emoji">
                <input
                  value={selected.params.emoji}
                  maxLength={16}
                  onChange={(e) => e.target.value && patchParams(selected, { emoji: e.target.value })}
                />
              </Prop>
              <Prop label="Posição">
                <Segmented
                  value={selected.params.position}
                  options={[
                    { value: "side", label: "Lateral" },
                    { value: "top", label: "Topo" },
                    { value: "center", label: "Peito" },
                  ]}
                  onChange={(v) => patchParams(selected, { position: v })}
                />
              </Prop>
            </>
          )}

          {selected.kind === "lowerThird" && (
            <>
              <Prop label="Nome">
                <input
                  value={selected.params.title}
                  maxLength={40}
                  onChange={(e) => e.target.value && patchParams(selected, { title: e.target.value })}
                />
              </Prop>
              <Prop label="Cargo">
                <input
                  value={selected.params.subtitle}
                  maxLength={60}
                  onChange={(e) => patchParams(selected, { subtitle: e.target.value })}
                />
              </Prop>
            </>
          )}

          {selected.kind === "counter" && (
            <>
              <Prop label="De → até">
                <ScrubNumber
                  value={selected.params.from}
                  step={selected.params.decimals > 0 ? 0.1 : 1}
                  onChange={(v) => patchParams(selected, { from: v })}
                />
                <Icon name="chevronRight" size={12} className="muted" />
                <ScrubNumber
                  value={selected.params.to}
                  step={selected.params.decimals > 0 ? 0.1 : 1}
                  onChange={(v) => patchParams(selected, { to: v })}
                />
              </Prop>
              <Prop label="Casas decimais">
                <Segmented
                  value={selected.params.decimals}
                  options={[
                    { value: 0, label: "0" },
                    { value: 1, label: "1" },
                    { value: 2, label: "2" },
                  ]}
                  onChange={(v) => patchParams(selected, { decimals: v })}
                />
              </Prop>
              <Prop label="Prefixo / sufixo">
                <input
                  value={selected.params.prefix}
                  maxLength={8}
                  placeholder="R$ "
                  onChange={(e) => patchParams(selected, { prefix: e.target.value })}
                />
                <input
                  value={selected.params.suffix}
                  maxLength={12}
                  placeholder=" meses"
                  onChange={(e) => patchParams(selected, { suffix: e.target.value })}
                />
              </Prop>
              <Prop label="Legenda">
                <input
                  value={selected.params.label}
                  maxLength={40}
                  placeholder="opcional"
                  onChange={(e) => patchParams(selected, { label: e.target.value })}
                />
              </Prop>
            </>
          )}

          {selected.kind === "flash" && (
            <Prop label="Cor">
              <ColorField
                value={selected.params.color}
                onChange={(v) => patchParams(selected, { color: v })}
              />
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

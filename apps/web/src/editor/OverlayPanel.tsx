import { outputDuration, type Overlay, type Recipe } from "@vision/recipe";
import React, { useEffect, useState } from "react";
import { listAssets, uploadAsset, type MusicTrack } from "../api";
import { Prop, ScrubNumber, Section, Segmented, Select, Slider, Toggle } from "../ui/controls";
import { Icon } from "./Icon";

/** Campos novos do overlay com valor neutro (uploads avulsos) */
const DEFAULTS = {
  blend: "normal" as const,
  opacity: 1,
  scale: 0.4,
  assetId: null,
  mediaDurationSeconds: null,
};

function newId(overlays: Overlay[]): string {
  return `ov_${String(overlays.length + 1).padStart(2, "0")}_${Date.now().toString(36)}`;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

interface OverlayPanelProps {
  recipe: Recipe;
  selectedId: string | null;
  playheadSeconds: number;
  onChange: (recipe: Recipe) => void;
  onSelect: (id: string | null) => void;
}

export const OverlayPanel: React.FC<OverlayPanelProps> = ({
  recipe,
  selectedId,
  playheadSeconds,
  onChange,
  onSelect,
}) => {
  const [assets, setAssets] = useState<MusicTrack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const overlay = recipe.overlays.find((o) => o.id === selectedId);
  const duration = outputDuration(recipe.timeline.segments);

  const refreshAssets = () => {
    listAssets(recipe.projectId).then(setAssets).catch(() => setAssets([]));
  };
  useEffect(refreshAssets, [recipe.projectId]);

  const setOverlays = (overlays: Overlay[]) => onChange({ ...recipe, overlays });

  const patch = (p: Partial<Overlay>) => {
    if (!overlay) return;
    setOverlays(recipe.overlays.map((o) => (o.id === overlay.id ? ({ ...o, ...p } as Overlay) : o)));
  };

  const addTitle = () => {
    const o: Overlay = {
      id: newId(recipe.overlays),
      kind: "title",
      text: "TÍTULO",
      file: null,
      start: Math.round(playheadSeconds * 100) / 100,
      end: null,
      position: "top",
      layout: "overlay",
      ...DEFAULTS,
    };
    setOverlays([...recipe.overlays, o]);
    onSelect(o.id);
  };

  const addMedia = async (file: File) => {
    setError(null);
    try {
      const uploaded = await uploadAsset(recipe.projectId, file);
      refreshAssets();
      const kind = file.type.startsWith("video") ? ("video" as const) : ("image" as const);
      const o: Overlay = {
        id: newId(recipe.overlays),
        kind,
        text: "",
        file: uploaded.file,
        start: Math.round(playheadSeconds * 100) / 100,
        end: Math.min(Math.round((playheadSeconds + 4) * 100) / 100, duration),
        position: "top",
        layout: "pip",
        ...DEFAULTS,
      };
      setOverlays([...recipe.overlays, o]);
      onSelect(o.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sorted = [...recipe.overlays].sort((a, b) => a.start - b.start);

  return (
    <>
      <Section
        title={`Overlays (${recipe.overlays.length})`}
        actions={
          <>
            <button className="sm" onClick={addTitle} title="Título fixo no playhead">
              <Icon name="text" size={13} /> Título
            </button>
            <label className="file-btn sm" title="Imagem ou vídeo sobre o vídeo principal">
              <Icon name="plus" size={13} /> Mídia
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) addMedia(f);
                  e.target.value = "";
                }}
              />
            </label>
          </>
        }
      >
        {sorted.length === 0 ? (
          <p className="empty-hint">
            Sem overlays. Um <strong>título</strong> fixo ou uma <strong>mídia</strong> (print,
            b-roll, logo) entram no playhead.
          </p>
        ) : (
          <div className="list">
            {sorted.map((o) => (
              <div
                key={o.id}
                className={`list-row ${o.id === selectedId ? "selected" : ""}`}
                onClick={() => onSelect(o.id === selectedId ? null : o.id)}
              >
                <span className="lr-time">{fmtTime(o.start)}</span>
                <Icon name={o.kind === "title" ? "text" : o.kind === "video" ? "film" : "layers"} size={13} />
                <span className="lr-main">{o.text || o.file?.split("/").pop()}</span>
                {o.layout === "fullscreen" && <span className="pill">tela cheia</span>}
                {o.layout === "sticker" && <span className="pill">sticker</span>}
              </div>
            ))}
          </div>
        )}
        {error && <p className="note error">{error}</p>}
      </Section>

      {overlay && (
        <Section key={overlay.id} title="Overlay · propriedades">
          {overlay.kind === "title" ? (
            <Prop label="Texto">
              <input value={overlay.text} onChange={(e) => patch({ text: e.target.value })} />
            </Prop>
          ) : overlay.assetId ? (
            <Prop label="Da biblioteca">
              <span className="timing">{overlay.text}</span>
            </Prop>
          ) : (
            <Prop label="Arquivo">
              <Select value={overlay.file ?? ""} onChange={(e) => patch({ file: e.target.value })}>
                {assets.map((a) => (
                  <option key={a.file} value={a.file}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Prop>
          )}
          <Prop label="Início">
            <ScrubNumber
              value={overlay.start}
              min={0}
              max={duration}
              step={0.1}
              unit="s"
              onChange={(v) => patch({ start: v })}
            />
          </Prop>
          <Prop label="Até o fim do vídeo">
            <Toggle
              checked={overlay.end === null}
              onChange={(v) =>
                patch({ end: v ? null : Math.min(Math.round((overlay.start + 4) * 10) / 10, duration) })
              }
              label="Até o fim do vídeo"
            />
            {overlay.end !== null && (
              <ScrubNumber
                value={overlay.end}
                min={overlay.start + 0.1}
                max={duration}
                step={0.1}
                unit="s"
                onChange={(v) => patch({ end: v })}
              />
            )}
          </Prop>
          {overlay.kind !== "title" && (
            <Prop label="Layout">
              <Select
                value={overlay.layout}
                onChange={(e) => patch({ layout: e.target.value as Overlay["layout"] })}
              >
                <option value="fullscreen">Tela cheia</option>
                <option value="sticker">Sticker (solto)</option>
                <option value="pip">PiP (janela no canto)</option>
                <option value="split-bottom">Split (metade de baixo)</option>
                <option value="overlay">Destaque central</option>
              </Select>
            </Prop>
          )}
          {overlay.kind !== "title" && overlay.layout === "sticker" && (
            <Prop label="Tamanho">
              <Slider
                value={overlay.scale}
                min={0.05}
                max={1}
                step={0.01}
                unit="%"
                format={(v) => String(Math.round(v * 100))}
                parse={(s) => Number(s) / 100}
                onChange={(v) => patch({ scale: v })}
              />
            </Prop>
          )}
          {overlay.kind !== "title" && (
            <>
              <Prop label="Mescla" hint="Screen some o preto (luz); Multiply some o branco (moldura/textura)">
                <Segmented
                  value={overlay.blend}
                  options={[
                    { value: "normal", label: "Normal" },
                    { value: "screen", label: "Screen" },
                    { value: "multiply", label: "Multiply" },
                  ]}
                  onChange={(v) => patch({ blend: v })}
                />
              </Prop>
              <Prop label="Opacidade">
                <Slider
                  value={overlay.opacity}
                  min={0}
                  max={1}
                  step={0.01}
                  unit="%"
                  format={(v) => String(Math.round(v * 100))}
                  parse={(s) => Number(s) / 100}
                  onChange={(v) => patch({ opacity: v })}
                />
              </Prop>
            </>
          )}
          <Prop label="Posição">
            <Segmented
              value={overlay.position}
              options={[
                { value: "top", label: "Topo" },
                { value: "center", label: "Centro" },
                { value: "bottom", label: "Base" },
              ]}
              onChange={(v) => patch({ position: v })}
            />
          </Prop>
          <div className="row row-end">
            <button
              className="sm danger"
              onClick={() => {
                setOverlays(recipe.overlays.filter((o) => o.id !== overlay.id));
                onSelect(null);
              }}
            >
              <Icon name="trash" size={13} /> Remover overlay
            </button>
          </div>
        </Section>
      )}
    </>
  );
};

import { outputDuration, type Overlay, type Recipe } from "@vision/recipe";
import React, { useEffect, useState } from "react";
import { listAssets, uploadAsset, type MusicTrack } from "../api";

function newId(overlays: Overlay[]): string {
  return `ov_${String(overlays.length + 1).padStart(2, "0")}_${Date.now().toString(36)}`;
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
  const overlay = recipe.overlays.find((o) => o.id === selectedId);
  const duration = outputDuration(recipe.timeline.segments);

  const refreshAssets = () => {
    listAssets(recipe.projectId).then(setAssets).catch(() => setAssets([]));
  };
  useEffect(refreshAssets, [recipe.projectId]);

  const setOverlays = (overlays: Overlay[]) => onChange({ ...recipe, overlays });

  const patch = (p: Partial<Overlay>) => {
    if (!overlay) return;
    setOverlays(
      recipe.overlays.map((o) => (o.id === overlay.id ? { ...o, ...p } : o))
    );
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
    };
    setOverlays([...recipe.overlays, o]);
    onSelect(o.id);
  };

  const addMedia = async (file: File) => {
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
    };
    setOverlays([...recipe.overlays, o]);
    onSelect(o.id);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Overlays</h2>
        <span className="block-nav">
          <button onClick={addTitle}>+ Título</button>
          <label className="asset-btn">
            + Mídia
            <input
              type="file"
              accept="image/*,video/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addMedia(f).catch(() => undefined);
                e.target.value = "";
              }}
            />
          </label>
        </span>
      </div>
      {!overlay ? (
        <p className="muted">
          {recipe.overlays.length === 0
            ? "Sem overlays. Adicione um título fixo ou uma mídia (imagem/vídeo)."
            : "Clique num overlay na timeline para editar."}
        </p>
      ) : (
        <>
          {overlay.kind === "title" ? (
            <label className="field">
              Texto
              <input
                value={overlay.text}
                onChange={(e) => patch({ text: e.target.value })}
              />
            </label>
          ) : (
            <label className="field">
              Arquivo
              <select
                value={overlay.file ?? ""}
                onChange={(e) => patch({ file: e.target.value })}
              >
                {assets.map((a) => (
                  <option key={a.file} value={a.file}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="field-row">
            <label className="field">
              Início (s)
              <input
                type="number"
                step={0.1}
                min={0}
                value={overlay.start}
                onChange={(e) =>
                  patch({ start: Math.max(0, Number(e.target.value)) })
                }
              />
            </label>
            <label className="field">
              Fim (s; vazio = até o final)
              <input
                type="number"
                step={0.1}
                min={0}
                value={overlay.end ?? ""}
                onChange={(e) =>
                  patch({
                    end: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                  })
                }
              />
            </label>
            <label className="field">
              Posição
              <select
                value={overlay.position}
                onChange={(e) => patch({ position: e.target.value as Overlay["position"] })}
              >
                <option value="top">Topo</option>
                <option value="center">Centro</option>
                <option value="bottom">Base</option>
              </select>
            </label>
            {overlay.kind !== "title" && (
              <label className="field">
                Layout
                <select
                  value={overlay.layout}
                  onChange={(e) => patch({ layout: e.target.value as Overlay["layout"] })}
                >
                  <option value="pip">PiP (janelinha)</option>
                  <option value="split-bottom">Split (metade de baixo)</option>
                  <option value="overlay">Destaque central</option>
                </select>
              </label>
            )}
          </div>
          <button
            className="danger"
            onClick={() => {
              setOverlays(recipe.overlays.filter((o) => o.id !== overlay.id));
              onSelect(null);
            }}
          >
            Remover overlay
          </button>
        </>
      )}
    </section>
  );
};

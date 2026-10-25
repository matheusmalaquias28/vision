import {
  COLOR_PRESETS,
  isNeutralGrade,
  NEUTRAL_GRADE,
  type ColorGrade,
  type ColorPresetId,
  type Recipe,
  type SourceTime,
} from "@vision/recipe";
import React, { useState } from "react";
import { autoColorApi } from "../api";
import { Prop, Section, Select, Slider } from "../ui/controls";
import { Icon } from "./Icon";

interface ColorPanelProps {
  recipe: Recipe;
  playheadSource: SourceTime | null;
  onChange: (recipe: Recipe) => void;
  /** Segurar "Ver original": o preview mostra o vídeo sem ajuste */
  onCompare: (showOriginal: boolean) => void;
}

const pct = (v: number) => {
  const d = Math.round((v - 1) * 100);
  return `${d > 0 ? "+" : ""}${d}`;
};
const fromPct = (s: string) => 1 + Number(s) / 100;
const PRESET_IDS = Object.keys(COLOR_PRESETS) as ColorPresetId[];

const sameGrade = (a: ColorGrade, b: ColorGrade) =>
  isNeutralGrade({
    exposure: 1 + a.exposure - b.exposure,
    contrast: 1 + a.contrast - b.contrast,
    saturation: 1 + a.saturation - b.saturation,
    temperature: a.temperature - b.temperature,
  });

/**
 * Ajuste de cor por vídeo bruto (vale para todos os trechos dele). O
 * automático mede o vídeo no servidor (ffmpeg) e só preenche os controles:
 * o operador vê no preview e ajusta.
 */
export const ColorPanel: React.FC<ColorPanelProps> = ({ recipe, playheadSource, onChange, onCompare }) => {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [measured, setMeasured] = useState<Record<string, string>>({});

  // segue o vídeo sob o playhead até o operador escolher outro
  const sourceId = picked ?? playheadSource?.sourceId ?? recipe.sources[0]?.id ?? null;
  const source = recipe.sources.find((s) => s.id === sourceId) ?? null;
  if (!source) return null;
  const grade = source.color ?? NEUTRAL_GRADE;
  const multi = recipe.sources.length > 1;
  const label = (i: number) => {
    const s = recipe.sources[i];
    return `Vídeo ${i + 1}${s.name ? ` · ${s.name}` : ""}`;
  };

  const setGrades = (ids: string[], g: ColorGrade | null) =>
    onChange({
      ...recipe,
      sources: recipe.sources.map((s) => (ids.includes(s.id) ? { ...s, color: g && !isNeutralGrade(g) ? g : null } : s)),
    });
  const patch = (p: Partial<ColorGrade>) => setGrades([source.id], { ...grade, ...p });

  const auto = async (ids: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const { grades } = await autoColorApi(recipe.projectId, ids);
      onChange({
        ...recipe,
        sources: recipe.sources.map((s) => {
          const g = grades[s.id]?.grade;
          return g ? { ...s, color: isNeutralGrade(g) ? null : g } : s;
        }),
      });
      setMeasured((m) => {
        const next = { ...m };
        for (const [id, r] of Object.entries(grades)) {
          const spread = Math.round((r.stats.yHigh - r.stats.yLow) * 100);
          next[id] =
            spread < 35
              ? `Imagem achatada (${spread}% de faixa de luz): parece LOG/flat, contraste e cor reforçados.`
              : `Faixa de luz de ${spread}%: ajuste leve.`;
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Ajuste de cor"
      actions={
        source.color ? <span className="pill">ajustado</span> : <span className="cr-muted">original</span>
      }
    >
      {multi && (
        <Prop label="Vídeo">
          <Select value={source.id} onChange={(e) => setPicked(e.target.value)}>
            {recipe.sources.map((s, i) => (
              <option key={s.id} value={s.id}>
                {label(i)}
                {s.color ? " (ajustado)" : ""}
              </option>
            ))}
          </Select>
        </Prop>
      )}

      <div className="color-actions">
        <button className="sm primary" disabled={busy} onClick={() => auto([source.id])} title="Mede o vídeo e corrige luz e cor (você ajusta depois)">
          <Icon name="sparkles" size={13} /> {busy ? "Medindo…" : "Automático"}
        </button>
        <button
          className="sm"
          disabled={!source.color}
          title="Segure para ver o vídeo sem ajuste"
          onPointerDown={() => onCompare(true)}
          onPointerUp={() => onCompare(false)}
          onPointerLeave={() => onCompare(false)}
        >
          <Icon name="eye" size={13} /> Ver original
        </button>
      </div>
      {measured[source.id] && <p className="note">{measured[source.id]}</p>}
      {error && <p className="note error">{error}</p>}

      <div className="color-presets">
        {PRESET_IDS.map((id) => {
          const p = COLOR_PRESETS[id];
          return (
            <button
              key={id}
              className={`chip ${sameGrade(grade, p.grade) ? "on" : ""}`}
              title={p.hint}
              onClick={() => setGrades([source.id], p.grade)}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <Prop label="Exposição">
        <Slider value={grade.exposure} min={0.3} max={2} step={0.01} unit="%" format={pct} parse={fromPct} onChange={(v) => patch({ exposure: v })} />
      </Prop>
      <Prop label="Contraste">
        <Slider value={grade.contrast} min={0.3} max={2.5} step={0.01} unit="%" format={pct} parse={fromPct} onChange={(v) => patch({ contrast: v })} />
      </Prop>
      <Prop label="Saturação">
        <Slider value={grade.saturation} min={0} max={3} step={0.01} unit="%" format={pct} parse={fromPct} onChange={(v) => patch({ saturation: v })} />
      </Prop>
      <Prop label="Temperatura" hint="Negativo esfria (azul), positivo esquenta (laranja)">
        <Slider
          value={grade.temperature}
          min={-1}
          max={1}
          step={0.01}
          format={(v) => String(Math.round(v * 100))}
          parse={(s) => Number(s) / 100}
          onChange={(v) => patch({ temperature: v })}
        />
      </Prop>

      {multi && (
        <div className="color-actions">
          <button
            className="sm ghost"
            title="Usa este ajuste em todos os vídeos do projeto (mesma câmera)"
            onClick={() => setGrades(recipe.sources.map((s) => s.id), source.color)}
          >
            Aplicar a todos os vídeos
          </button>
          <button className="sm ghost" disabled={busy} title="Mede e corrige cada vídeo separadamente" onClick={() => auto(recipe.sources.map((s) => s.id))}>
            Automático em todos
          </button>
        </div>
      )}
    </Section>
  );
};
